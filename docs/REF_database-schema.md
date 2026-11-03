<!-- ============================================================ -->
<!-- Vigil Platform — Database Schema Reference          -->
<!-- @author Prakasit Rochanavipart (Dojo-mAn)                   -->
<!-- @copyright (c) 2025-2026 All Rights Reserved.               -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Database Schema Reference — PostgreSQL

> **วัตถุประสงค์:** เอกสารอ้างอิงสำหรับ DBA, ทีม integration, หรือ 3rd party ที่ต้องการเชื่อมต่อ / อ่านข้อมูลจากฐานข้อมูลนี้  
> Last updated: 2026-08-11 · Version: v1.5.3 — schema changelog now current through migration 142; base-table count corrected (see §9/ARCHITECTURE.md)  
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

📁 Storage & Files
   public_files            — ไฟล์ที่แอดมินอัปเพื่อส่งลูกค้า (File Service) → 3.17
   storage_stats           — ผลวัดพื้นที่รายหมวดต่อเครื่อง → 3.18

📈 Rollup (หน้าร้อน ๆ อ่านตัวนี้แทน events / license_plates)
   event_dim_bucket        — จำนวน event ต่อ 30 นาที ตามมิติของกฎหมวดหมู่ → 3.19
   lpr_dim_daily           — ยอดกราฟ LPR ต่อวัน × กล้อง × มิติ → 3.20
   lpr_hourly_stats        — ยอด LPR รายชั่วโมงต่อกล้อง (migration 171)
```

> ⚠️ รายการข้างบนเป็น **ตารางหลักที่ใช้บ่อย ไม่ใช่ทั้งหมด** — ฐานข้อมูลจริงมีตาราง
> มากกว่านี้หลายเท่า การไล่ให้ครบเป็นงานคนละก้อน (ดู `docs/ARCH_documentation-governance.md`)

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
| `vca_rule_issues` | JSONB | migration 249 — array ของ IVA task (rule) ที่ชื่อมีปัญหา `[{id,type,name,problem}]`, `problem` ∈ `bad_utf8`/`at_limit`/`wildcard`/`control_char` (ชื่อ ≥64 byte ถูกกล้อง Bosch ตัดกลางตัวอักษร → broker ทิ้ง/ตัดการเชื่อมต่อ) — ตรวจอ่านอย่างเดียว ไม่เขียนกลับกล้อง |
| `vca_rules_checked_at` | TIMESTAMPTZ | migration 249 — เวลาตรวจ `vca_rule_issues` ล่าสุด (อ่านไม่สำเร็จ = ไม่อัปเดตทั้งสองคอลัมน์ กันปัญหาที่รู้แล้วถูกเคลียร์ทิ้งเงียบ ๆ) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:** `group_id`, `enabled`, `last_seen_at DESC`

---

### 3.3 `events`
**ตารางหลักและใหญ่สุด** — IVA events จากกล้องทุกตัว ผ่าน MQTT ingester

> 🔀 **เป็น partitioned table แล้ว** (ตั้งแต่ 2026-07-22, `195d743` · CEN-003 ·
> `db/MANUAL_partition_events_option_a.sql` — เป็น manual migration ไม่ใช่ไฟล์ที่ `migrate.js` รันเอง
> เพราะต้องล็อกตารางจริง วัด lock window ได้ ~90.7 วินาที)
>
> - `PARTITION BY RANGE (event_time)` · **partition รายเดือน** ชื่อ `events_yYYYYmMM`
>   (`PART_RE` ใน `src/helpers/partitionRetention.js:45`) + `events_default` รับแถวที่หลุดทุกช่วง
> - **PK เปลี่ยนเป็น `(id, event_time)`** — Postgres บังคับว่า partition key ต้องอยู่ใน PK ·
>   โค้ดที่ยัง `WHERE id = $1` เฉย ๆ จะสแกนทุก partition ให้ใส่ขอบ `event_time` ด้วยเสมอ
> - ไฟล์ manual สร้าง partition ไว้ **2026-01 ถึง 2027-12 (24 ใบ) + `events_default`** ·
>   เดือนถัดไปต้องสร้างเองตาม Step 7 ในไฟล์นั้น (**ไม่มีโค้ดสร้างล่วงหน้าให้**)
> - ของเก่าถูกลบด้วย `enforcePartitionRetention()` — `DROP TABLE` ทั้งใบ (ทันที) แทน `DELETE`
>   ที่ทิ้ง dead tuple ไว้เป็นล้าน · **ต้องเปิดด้วย `system_settings.partition_drop_enabled = 'true'`**
>   ก่อนถึงจะลบจริง และจะลบก็ต่อเมื่อพ้น **ค่าที่มากกว่า** ระหว่าง `data_retention_days` กับ
>   `lpr_retention_days` (partition ใบเดียวถือทั้งสองชนิด)
> - `ON DELETE CASCADE` ของ FK ลูกถูกถอดตอนแปลง → ลูกทั้ง 5 ตาราง (`appearances`,
>   `license_plates`, `face_event_notes`, `face_event_acks`, `lpr_alert_acks`) ต้องถูกล้างเอง
>   ก่อน drop partition (`195d743`)
> - ผลข้างเคียงที่เห็นบน API: `count(*)` ทั้งตารางกลายเป็น full scan 40 วินาที →
>   `/api/health/details` เปลี่ยนไปใช้ `SUM(reltuples)` ต่อ partition แทน (decision #263)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT | ส่วนหนึ่งของ PK `(id, event_time)` · ยัง `GENERATED`/sequence เหมือนเดิม |
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

**Indexes:** `camera_id`, `event_time DESC`, `event_type`, `rule_name`, `object_class`, `(camera_id, event_time DESC)`, partial indexes on `has_snapshot`, GIN on `raw_json`,
`idx_events_time_id (event_time DESC, id DESC)` (m.071),
**`idx_events_anpr_noread_time (event_time DESC, id DESC) WHERE event_type = 'anprAlarm' AND COALESCE(raw_json->>'plate','') = ''`** (m.199 — แท็บ "ไม่ทราบทะเบียน")

> ⚠️ index ทุกตัวเป็น **partitioned index** แล้ว — `CREATE INDEX CONCURRENTLY` บน parent
> ทำไม่ได้เลยใน Postgres 16 · บน production ต้องสร้างทีละใบด้วย
> `scripts/create-face-blacklist-index.js --index=<name>` (ลูกทีละตัว → แม่แบบ `ON ONLY` → `ATTACH`)
> **เกณฑ์ว่าเสร็จคือ `pg_index.indisvalid = true`** ไม่ใช่ "สร้างครบทุกใบ" — แม่แบบยัง invalid
> จนกว่าจะ ATTACH ครบ และ planner ไม่แตะ index ที่ invalid

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
| `vehicle_type` `vehicle_color` `vehicle_brand` | VARCHAR | ANPR attrs (brand = Hik numeric code) |
| `plate_image` | VARCHAR | path ของภาพ crop ป้าย |
| `no_seatbelt` | BOOLEAN | **migration 073** — ผู้ขับ/ผู้โดยสารไม่คาดเข็มขัด (parse `pilot/vicepilotsafebelt` ตอน ingest); partial index `idx_plates_no_seatbelt … WHERE no_seatbelt`; แทน filter LIKE rawXml (decision #214) |

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
| `data_retention_days` | `365` | เก็บ events (general) กี่วัน (max 730) — **ยกเว้น anprAlarm** (decision #213) |
| `snapshot_retention_days` | `30` | เก็บ snapshot images กี่วัน (max 365) |
| `lpr_retention_days` | `30` | เก็บ LPR row (anprAlarm+license_plates) — sole authority ของ LPR (max 730) |
| `lpr_image_retention_days` | `7` | เก็บ LPR image files (≤ lpr_retention) |
| `rawxml_retention_days` | `90` | **migration 074** — strip `raw_json.rawXml` เก่ากว่านี้ (class-D, `enforceRawXmlRetention`, decision #212) |
| `clip_retention_days` `appearances_retention_days` | `30` `40` | clip files / biometric rows |
| `display_timezone` | `Asia/Bangkok` | timezone สำหรับ date boundaries |
| `counter_dedup_mode` | `state` | `state` / `object_window` / `none` |
| `comparison_mode` | `rolling` | `rolling` / `calendar` |
| `custom_range_max_days` | `365` | max span ของ date range picker |
| `analytics_event_display` | CSV of camera-auto types | types ที่แสดงใน Events feed |
| `brand_name` | `Vigil Platform` | ชื่อ product (white-label) |
| `brand_tagline` | `CCTV Analytics Suite` | subtitle |
| `brand_logo_path` | `` (empty) | path ไฟล์โลโก้ |
| `brand_primary_color` | `#5b8def` | accent color หลัก |
| `mapbox_token` | `` (empty) | token ของ Mapbox สำหรับหน้า Map (migration 029, decision #171) |
| `api_log_retention_days` | `90` | เก็บ log ของ Partner API กี่วัน (migration 122) |
| `lpr_line_image_expire_hours` | `24` | อายุรูปบน imgbb ของ LPR alert (migration 114) |
| `nav_hidden_pages` | `["media"]` | JSON array ของเมนูที่ **ซ่อน** (hide-list ไม่ใช่ show-list) — migration 141, decision #239 |
| `signed_image_expire_hours` | (ไม่ seed) | อายุลิงก์รูปที่เซ็นชื่อจากโดเมนเราเอง · clamp **1–720 ชม.** (migration 147) — ดู `docs/LOGIC_line-notifications.md` |
| `lpr_noread_check` | (เขียนโดยงาน) | ผล self-check รายสัปดาห์ของนิยาม "ไม่ทราบทะเบียน" (migration 199) เป็น JSON `{checked_at, hours, predicate, anti_join, mismatch, ok}` · เขียนโดย `src/helpers/noreadCheck.js` อาทิตย์ 04:30 · อ่านที่ `/api/health/details → lpr.noread_check` |
| `traffic_stats_reconciled_day` | (เขียนโดยงาน) | วันที่ (เวลาไทย) ที่ reconcile ของ traffic/lpr hourly stats ทำไปแล้ว — กัน api-server restart ในชั่วโมง reconcile ลากงานหนักมาทำซ้ำ (decision #267, `src/traffic-stats-refresher.js:57`) |
| `partition_drop_enabled` | `false` | ต้องเป็น `'true'` ถึงจะ `DROP` partition ของ `events` จริง — ดู §3.3 |

Schema: `key VARCHAR(80) PK`, `value TEXT`, `description TEXT`, `updated_at TIMESTAMPTZ`

> สอง key ล่าง ๆ ที่มีหมายเหตุ "เขียนโดยงาน" ไม่ได้ถูก seed จาก migration — แถวจะโผล่หลังงาน
> เบื้องหลังรันครั้งแรก การไม่มีแถว ≠ ค่าผิด

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

### 3.17 `public_files`

ไฟล์ที่แอดมินอัปเพื่อส่งให้ลูกค้า (File Service) — migration 179 · ไฟล์จริงอยู่ที่ `files/`
ชื่อบนดิสก์เป็น uuid ที่ระบบสร้างเอง ส่วน `original_name` ใช้แสดงและตั้งชื่อตอนดาวน์โหลดเท่านั้น
**ไม่เคยถูกใช้ประกอบ path**

| Column | Type | Null | หมายเหตุ |
|---|---|---|---|
| `id` | `serial` | NO | PK |
| `stored_name` | `text` | NO | **UNIQUE** · `<uuid>.<ext>` ที่ระบบสร้าง — คีย์ที่ `/pub/fil/` ใช้ค้น |
| `original_name` | `text` | NO | ชื่อที่ผู้ใช้อัปมา (เก็บเป็น UTF-8 หลังถอดจาก latin-1 ของ busboy) |
| `mime` | `text` | NO | ตัดสินจาก magic bytes ไม่ใช่จาก client |
| `bytes` | `bigint` | NO | ขนาดไฟล์ |
| `sha256` | `text` | NO | hash ของเนื้อไฟล์ |
| `uploaded_by` | `text` | YES | username ของแอดมินที่อัป |
| `uploaded_at` | `timestamptz` | NO | default `now()` |
| `expires_at` | `timestamptz` | YES | ถึงเวลาแล้ว `/pub/fil/` ตอบ 410 และรอบกวาดรายวันลบไฟล์ออกจากดิสก์ |
| `revoked_at` | `timestamptz` | YES | ตั้งเมื่อกดเพิกถอน **หรือ**เมื่อรอบกวาดลบไฟล์ทิ้ง — แถวยังอยู่เพื่อ audit |
| `note` | `text` | YES | หมายเหตุที่แอดมินพิมพ์ |

Index: `idx_public_files_uploaded_at (uploaded_at DESC)` ·
`idx_public_files_revoked_at` และ `idx_public_files_expires_at` (partial `WHERE ... IS NOT NULL`)

> `revoked_at IS NOT NULL` แต่ไฟล์ไม่อยู่บนดิสก์ = สภาพปกติ ไม่ใช่ข้อมูลเพี้ยน
> การเพิกถอนลบไบต์ทิ้งแต่เก็บแถวไว้โดยตั้งใจ

---

### 3.18 `storage_stats`

ผลการวัดพื้นที่จัดเก็บรายหมวดต่อเครื่อง (หน้า Health → จัดเก็บ) — migrations 176/178
**เป็นค่าจากรอบวัด ไม่ใช่ค่าสด** อ่านคู่กับ `measured_at` เสมอ

| Column | Type | Null | หมายเหตุ |
|---|---|---|---|
| `machine` | `text` | NO | `central` หรือ site code ของ edge · PK ร่วมกับ `category` |
| `category` | `text` | NO | `events` · `lpr` · `lpr-watchlist` · `face-blacklist` · `blacklist-photos` · `reports` · `public-files` · `root-flat` |
| `bytes` | `bigint` | NO | ผลรวมขนาดไฟล์ (apparent) |
| `bytes_disk` | `bigint` | NO | **พื้นที่ที่ถูกจับจองจริง** (`st.blocks * 512`) — ตัวที่ควรใช้ตัดสินใจ ต่างจาก `bytes` ได้เกิน 2 เท่าเมื่อไฟล์เล็กเยอะ |
| `files` | `bigint` | NO | จำนวนไฟล์ |
| `oldest_at` | `timestamptz` | YES | mtime ของไฟล์เก่าสุด |
| `partial` | `boolean` | NO | `true` = วัดไม่จบใน time budget ตัวเลขต่ำกว่าจริง |
| `disk_total` / `disk_used` | `bigint` | YES | ของทั้งดิสก์ที่โฟลเดอร์นั้นอยู่ |
| `scan_ms` | `integer` | YES | เวลาที่ใช้วัดรอบนั้น |
| `measured_at` | `timestamptz` | NO | default `now()` |
| `orphans` / `orphans_bytes_disk` / `orphans_at` | `bigint` / `bigint` / `timestamptz` | YES | จำนวนไฟล์ที่ไม่มีแถวใน `events` อ้างถึง — **แสดงอย่างเดียว ยังไม่เปิดให้ลบ** เพราะ event ~2.5% ไม่ได้บันทึก `snapshot_filename` รูปของมันจึงหน้าตาเหมือนไม่มีเจ้าของทั้งที่ยังเป็นหลักฐาน |

---

### 3.19 `event_dim_bucket` (rollup)

สรุปจำนวน event **ต่อ 30 นาที** ตามมิติที่กฎหมวดหมู่ใช้ตัดสิน — migration **163** (2026-08-19)

| Column | Type | Null | หมายเหตุ |
|---|---|---|---|
| `bucket` | `timestamptz` | NO | `date_bin('30 minutes', event_time, '2000-01-01')` |
| `camera_id` | `varchar(80)` | NO | |
| `rule_name` / `event_type` / `object_class` / `vehicle_type` / `event_state` | `varchar` | NO | **`NOT NULL DEFAULT ''`** — ไม่ใช่ `NULL` · ผู้อ่านต้อง `NULLIF(x,'')` เองถ้าต้องการ shape เดิม |
| `n` | `integer` | NO | จำนวน event ใน bucket นั้น |
| `updated_at` | `timestamptz` | NO | |

**PK:** `(bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state)`

- **ผู้เขียน:** `src/category-rollup-refresher.js` — ทุก **5 นาที** (`CAT_ROLLUP_REFRESH_MS`)
  upsert หน้าต่างย้อนหลัง **3 ชม.** (`CAT_ROLLUP_LOOKBACK_HOURS`) แล้วลบของเก่าตาม `RETENTION_DAYS`
- **ผู้อ่าน:** `/api/health/details` (`events.face_total`/`lpr_total`, `image_quality`) ·
  `/api/cameras/image-quality-log` (`X-Total-Count`) · `/api/categories/rule-discovery` ·
  endpoint ของหน้าสถิติ
- ⚠️ **ตามหลังของจริง ≤ ~5 นาที** และ **ต่ำกว่าถาวรได้เล็กน้อย**: upsert เขียน `n = EXCLUDED.n`
  เฉพาะในหน้าต่าง 3 ชม. → event ที่มาถึงช้ากว่านั้นไม่ถูกนับเข้า bucket เดิมอีกเลย
  (เจอจริง bucket 2026-08-24 07:30 ของ BSH-HDY-4031: dim 2 vs events 4)

---

### 3.20 `lpr_dim_daily` (rollup)

สรุป **รายวัน × กล้อง × มิติ** ของกราฟจังหวัด/ประเภทรถ/สีป้าย/ยี่ห้อ — migration **171** (2026-08-23)
เก็บเป็น long format (หนึ่งแถว = หนึ่งค่าของหนึ่งมิติ) ≈ 15,000 แถว/วัน · ถ้าเก็บแบบ cross
ทุกมิติจะได้ 1.27 ล้านแถว/เดือน

| Column | Type | Null | หมายเหตุ |
|---|---|---|---|
| `day` | `date` | NO | |
| `camera_id` | `varchar(100)` | NO | |
| `dim` | `text` | NO | `region` · `vehicle_type` · `plate_color` · `vehicle_brand` |
| `value` | `text` | NO | ค่าของมิตินั้น |
| `n` | `integer` | NO | |
| `updated_at` | `timestamptz` | NO | |

**PK:** `(day, camera_id, dim, value)` · **Index:** `idx_lpr_dim_daily_day (day, dim)`

- **ผู้เขียน:** `src/traffic-stats-refresher.js:187-197` — ทุก **15 นาที**
  (`TRAFFIC_STATS_REFRESH_MS`) ย้อนหลัง 3 ชม. · **delete-then-insert ต่อวันที่แตะ** ไม่ใช่ upsert
  ต่อแถว · reconcile 168 ชม. วันละครั้ง **05:00 เวลาไทย** (decision #267 — ตี 3 เดิมชนกับ
  `pg_dump` ที่จบราว 04:05) จำวันล่าสุดไว้ที่ `system_settings.traffic_stats_reconciled_day`
  เพื่อไม่ให้ restart ในชั่วโมงนั้นลากงานหนักมาทำซ้ำ
- **ผู้อ่าน:** `GET /api/lpr/brands` (`dim = 'vehicle_brand'`, cache 30 นาทีทับอีกชั้น) ·
  กราฟของหน้า LPR
- migration 171 ยังสร้าง `lpr_hourly_stats` (PK `(camera_id, bucket_hour)`) ในไฟล์เดียวกัน

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
| _041–070_ | (LPR gates/watchlist/alerts, sites/multi-site, appearances, edge_status m.067, reports — see `db/` + git) |
| migration_071 | `events`: keyset index `idx_events_time_id (event_time DESC, id DESC)` — LPR keyset pagination (decision #211) |
| migration_072 | `edge_status`: เพิ่ม `snapshot_oldest (DATE)`, `snapshot_dirs (INT)` — edge snapshot inventory (decision #214) |
| migration_073 | `license_plates`: เพิ่ม `no_seatbelt (BOOLEAN)` + partial index `idx_plates_no_seatbelt WHERE no_seatbelt` (decision #214) |
| migration_074 | `system_settings`: seed `rawxml_retention_days = 90` (class-D retention, decision #212) |
| migration_075 | `event_categories`: เพิ่ม `site_id` column พร้อม unique constraint ต่อ site, backfill เข้า main site |
| migration_076 | `event_categories`: เพิ่ม `is_locked` (แทน `is_builtin`), ย้าย category ทั้งหมดไป VSS site (site_id=4), อัปเดต public view |
| migration_077 | `cameras`: เพิ่ม `sort_order` สำหรับจัดเรียง grid หน้า Camera Status ด้วยมือ |
| migration_078 | `edge_status`: เปลี่ยน `site_id` FK เป็น cascade-delete เมื่อ site ถูกลบ |
| migration_079 | `events`: normalize casing/token ของ `plateColor` ใน `raw_json`, backfill แถวเดิม |
| migration_080 | `events`: backfill `object_class` ของ `anprAlarm` จาก mapping `license_plates.vehicle_type` |
| migration_081 | `events`: แยก "Pickup" เป็น `object_class` ของตัวเองจาก "Truck" สำหรับ `anprAlarm` |
| migration_082 | `appearances`: backfill แถวของ FaceRecognition event เก่าที่ไม่เคย insert appearance ทันที |
| migration_083 | `cameras`: เพิ่ม `nvr_channel`, `capture_categories`, `device_id` รองรับ NVR หลายช่อง (Phase 3) |
| migration_084 | `license_plates`: เพิ่ม `plate_type` จากสีพื้นป้าย (หมวดการจดทะเบียนของไทย) |
| migration_085 | `license_plates`: เพิ่ม `plate_color`, `no_helmet` สำหรับ performance ของ `/api/lpr/stats` |
| migration_086 | `license_plates`: เพิ่ม trigram GIN index บน `plate_number` สำหรับค้นแบบ wildcard |
| migration_087 | `cameras`: เพิ่ม `recording_nvr_id` แมปกล้อง LPR แบบ standalone เข้ากับ NVR ที่บันทึกจริง |
| migration_088 | `event_category_rules`: เพิ่ม `vehicle_type` ให้ mapping rule จับชนิดรถ LPR ได้ละเอียดขึ้น |
| migration_089 | `events`: denormalize `vehicle_type` จาก `license_plates` เพื่อ perf ของ `stats.js` (เลี่ยง join), backfill แถว `anprAlarm` |
| migration_090 | `license_plates`: เพิ่ม `rider_count` (smallint) สำหรับตรวจคนซ้อนท้ายของ Dahua ITC431 พร้อม partial index กรณี 3+ คน |
| migration_091 | `cameras`: เพิ่ม `model_detected_at`, `model_detect_error` เก็บ audit trail ของการ auto-detect รุ่นกล้อง |
| migration_092 | `license_plates`: เพิ่ม index บน `detected_at` สำหรับ query KPI ของ Executive Summary |
| migration_093 | สร้าง schema `blacklist.*` (sources, source_records, master, master_links) + `lpr_watchlist` หลายแหล่งข้อมูล พร้อม PII encryption และ origin tracking |
| migration_094 | `blacklist.overrides`/`blacklist.source_records`/`blacklist.master`: เพิ่มชั้นแก้ไขข้อมูลในเครื่อง (local correction) พร้อม plate dedup key และ push-back gate |
| migration_095 | `blacklist.source_records`/`blacklist.master`: แก้ความหมาย `case_ref`/`display_name` ให้ตรงกับแต่ละชนิดแหล่งข้อมูล |
| migration_096 | `blacklist.bridge_rules`/`blacklist.sources`: สร้างชั้น bridge-rule เชื่อม blacklist เข้า `lpr_watchlist` พร้อม preset แบบ group/เลือกเอง |
| migration_097 | `metrics_host`: สร้างตาราง time-series วัด performance host (คาด ~1.58M แถว/ปี) — CPU/RAM/disk/network |
| migration_098 | `edge_status`: เพิ่ม `last_svc_result` แสดงผลลัพธ์คำสั่ง restart/stop ที่ยิงผ่าน MQTT |
| migration_099 | `lpr_watchlist_groups`: ย้าย `alert_mode` จากระดับป้ายไปเป็นระดับ group พร้อม `default_alert_mode` |
| migration_100 | `edge_status`: เพิ่ม `storage_json` เก็บสถานะ mdraid + mount point จาก edge heartbeat |
| migration_101 | `metrics_host`: เพิ่ม `tunnel_up`, `tailscale_up` วัดการเชื่อมต่อรายเครื่อง |
| migration_102 | `camera_httphost_backups`: สร้างตาราง append-only เก็บ backup ค่า httpHost ก่อน repoint กล้อง ANPR |
| migration_103 | `events`: เพิ่ม partial expression index จับคู่ Dahua FaceDetector/Comparison ข้าม partition (66.5s→5.5s สำหรับค้น appearances) |
| migration_104 | `license_plates`: เพิ่ม functional index บน `UPPER(plate_number)` สำหรับ join กับ watchlist (1.13s→0.046s สำหรับนับ alert) |
| migration_105 | `events`: ปรับ autovacuum ต่อ partition (`scale_factor 0.02`, `cost_limit 2000`) ให้ตามทัน insert 370k แถว/วัน |
| migration_106 | `blacklist.sources`: เพิ่ม `kept_types` คุมการมองเห็นของชนิดข้อมูลที่เลิกใช้แล้วโดยไม่ต้องลบ |
| migration_107 | `blacklist.sources`: ตั้งเวลา sync อัตโนมัติ + ตัวเลือก push (`pull_interval_hours`, `push_types`, `push_mode`, `push_auto_enabled`) |
| migration_108 | `license_plates`: แปลง field เฉพาะ rawXml ของ ANPR เป็นคอลัมน์ (`plate_char_believe`, `license_bright`) |
| migration_109 | `sites`: นโยบาย retention รูปภาพต่อ site (`retention_events_days`, `retention_lpr_days`, `retention_face_days`, `retention_min_free_gb`) |
| migration_110 | `edge_status`: ให้ edge รายงานสถานะ retention กลับมา (`retention_json`, `last_prune_json`) |
| migration_111 | `edge_status`: เก็บ inventory รูปภาพต่อโฟลเดอร์จาก edge (`inventory_json`) |
| migration_112 | `lpr_watchlist_groups`/`lpr_alert_cooldown`/`lpr_alert_hourly`: LINE alert สำหรับป้ายที่ตรง watchlist |
| migration_113 | `lpr_watchlist`: ให้ `notify_line` มีความหมายจริง (default true, ปิดได้ต่อป้าย) |
| migration_114 | `system_settings`: อายุลิงก์รูปบน imgbb สำหรับ LPR alert (`lpr_line_image_expire_hours`) |
| migration_115 | `cameras`: รายละเอียด microSD (`sd_detail_json` รูปแบบต่างตามยี่ห้อ) |
| migration_116 | `cameras`: ระยะเวลาถือ event บัฟเฟอร์สูงสุด (`max_hold_sec`, `max_hold_at`) |
| migration_117 | `license_plates`/`system_settings`: bounding box ระดับรถ + 3 ตัวเลือกเปิด/ปิดการโชว์ bbox |
| migration_118 | ซ่อม role `third_party_readonly` ที่หายไป คืน grant เข้า view `v_*_public` |
| migration_119 | `api_consumers`/`api_request_log`: สร้าง Partner API consumer + audit log การเรียก (Phase TP1a) |
| migration_120 | `v_cameras_public`/`api_consumers`: ตัด view กล้องให้แคบลง (เอาคอลัมน์ network/config ภายในออก), เพิ่ม `max_lookback_days` + `site_codes` scoping |
| migration_121 | `appearances`: เพิ่ม index สำหรับ cursor paging (`idx_appearances_time_id` บน `detected_at, id`) |
| migration_122 | `system_settings`: retention ของ partner API request log (`api_log_retention_days`, default 90 วัน) |
| migration_123 | `api_consumers`: วันหมดอายุของ credential พันธมิตร (decision #234) |
| migration_124 | `blacklist.sources`: เพิ่มแหล่งข้อมูล "manual" (ป้ายพิมพ์เอง) |
| migration_125 | `system_settings`: ชี้ชัดว่า `snapshot_retention_days` ใช้กับดิสก์ central เท่านั้น |
| migration_126 | `hcp_camera_map`: แมป `cameraIndexCode` ของ HCP เข้ากับ `camera_id` ของเรา |
| migration_127 | `alert_rules`: กฎแจ้งเตือนเมื่อ HCP เจอใบหน้าตรง |
| migration_128 | `blacklist.source_records`: ติดตามแถวที่หายไปจากต้นทาง (vanished records) |
| migration_129 | `face_embeddings`/`face_blacklist`/`face_embed_queue`: face embedding สำหรับ AuraFace-v1 |
| migration_130 | `alert_rules`: กฎแจ้งเตือนเมื่อ AuraFace-v1 เจอ blacklist ตรง |
| migration_131 | `face_embed_queue`/`face_embeddings`: denormalize `camera_id` เพื่อความเร็วในการค้น |
| migration_132 | `vec_dot()`: แก้ performance ที่ถดถอยลงจาก migration 131 (ดู GOTCHAS #149) |
| migration_133 | `face_blacklist`: เพิ่ม `enrolled_ref` กัน enrollment รันซ้ำแล้วพัง |
| migration_134 | `face_blacklist_hits`: log การจับคู่ blacklist ของ AuraFace-v1 |
| migration_135 | `system_settings`: threshold การจับคู่ของ AuraFace-v1 |
| migration_136 | `face_blacklist`: backfill `enrolled_ref` ให้ batch แรกที่ enroll จาก HCP |
| migration_137 | `face_blacklist_groups`/`face_blacklist`: กลุ่ม + toggle แจ้ง LINE รายแถว |
| migration_138 | `face_embed_queue`: index camera+time สำหรับกันข้อมูลซ้ำ |
| migration_139 | `face_embed_queue`: unique constraint บน `time_bucket` กันซ้ำตอนมีหลาย process แข่งกัน |
| migration_140 | เพิ่ม `AFTER UPDATE` trigger บน `users.password_hash` — เขียน `audit_log` เสมอไม่ว่าจะแก้ผ่าน path ไหน (แม้ SQL ตรง) redact bcrypt hash ออกจาก query text ที่บันทึก, ห่อด้วย exception handler ไม่ให้ trigger พังของเดิม (GOTCHAS #150) |
| migration_141 | `system_settings`: seed `nav_hidden_pages = '["media"]'` (JSON array ของเมนูที่ซ่อน, decision #239) |
| migration_142 | เพิ่มตาราง `traffic_hourly_stats` (camera_id, bucket_hour, vehicle_type, n_total, n_no_helmet, n_no_seatbelt, n_riders3, PK รวม 3 คอลัมน์แรก) — pre-aggregate ของ `license_plates` สำหรับหน้า Traffic Enforcement (decision #237) |
| migration_143 | per-user view authorization (2026-08-12, decision #250–#255) |
| migration_144 | `event_kpi_hourly` — ยอดสรุป KPI รายชั่วโมง (2026-08-12) |
| migration_145 | ปรับหน้าตาการ์ดแจ้งเตือน LINE ได้ต่อ rule (2026-08-13) |
| migration_146 | กฎประจำระบบที่ลบไม่ได้ (alert channel) (2026-08-13) |
| migration_147 | **`signed_image_expire_hours`** — อายุลิงก์รูปของเราเอง + ทางสำรอง imgbb ที่ตรวจได้ (2026-08-13) |
| migration_148 | รอบดึงข้อมูลโรสเตอร์คิดเป็นนาที (`pull_interval_minutes`) (2026-08-13) |
| migration_149 | แก้ไขข้อมูลโรสเตอร์ได้ครบทุกช่อง + รูป (override fields) (2026-08-13) |
| migration_150 | BS2 · ย้ายแถวที่ต้นทางลบแล้วลงถังขยะย้อนหลัง (2026-08-13) |
| migration_151 | CH1 · ประวัติการแก้ไขที่ต้นทางทำกับระเบียน (2026-08-13) |
| migration_152 | AcuSeek query logging (2026-08-14) |
| migration_153 | AcuSeek: บันทึกคำที่ "รู้จักแต่ไม่ได้ใช้" (2026-08-14) |
| migration_154 | ล้างสถานะกล้องที่ไม่มีใครดูแลแล้ว (2026-08-15) |
| migration_155 | `camera_status.reported_by` — แยกให้ออกว่าใครเป็นคนรายงานสถานะกล้อง (2026-08-15) |
| migration_156 | ผูกสถานะกล้องเข้ากับตารางกล้อง (FK) (2026-08-15) |
| migration_157 | covering index ของหน้า "อันดับไม่สวมหมวกนิรภัย" (2026-08-16) |
| migration_158 | extended statistics `no_helmet × vehicle_type` (2026-08-16) |
| migration_159 | `brand_footer_logo` setting (2026-08-17) |
| migration_160 | โหมดแหล่งภาพ snapshot ต่อกล้อง (2026-08-18) |
| migration_161 | FB1 · bridge rule จาก blacklist → `face_blacklist` (2026-08-19) |
| migration_162 | หนึ่งแถว `face_blacklist` ที่ bridge เป็นเจ้าของต่อหนึ่งตัวตน (unique) (2026-08-19) |
| migration_163 | **เพิ่มตาราง `event_dim_bucket`** — rollup 30 นาทีตามมิติที่กฎหมวดหมู่ใช้ (2026-08-19) — ดู §3.19 |
| migration_164 | ONVIF metadata crop ต่อกล้อง (Bosch เท่านั้น) (2026-08-19) |
| migration_165 | overlay เส้นทางวัตถุต่อกล้อง (2026-08-20) |
| migration_166 | ปักหมุดป้ายที่ bridge เข้ากับกลุ่มแจ้งเตือนที่คนเลือก (2026-08-20) |
| migration_167 | ดัชนีบางส่วนของแถบ "บุคคลเฝ้าระวัง" ในหน้าข้อมูลใบหน้า (2026-08-21) |
| migration_168 | ดัชนีบางส่วนของแท็บ "จดจำใบหน้า" (`?hits_only=1`) (2026-08-22) |
| migration_169 | `face_blacklist`: sha1 ของรูปต้นทางบนแถวที่มาจาก bridge (2026-08-22) |
| migration_170 | ตารางสรุป "จำนวนที่ใช้เป็นหลักฐานได้" คู่กับยอดรวม (traffic helmet evidence) (2026-08-23) |
| migration_171 | **เพิ่ม `lpr_hourly_stats` + `lpr_dim_daily`** — ตารางสรุปของหน้าป้ายทะเบียน (2026-08-23) — ดู §3.20 |
| migration_172 | `report_history.image_source` — ลิงก์รายงาน PNG จากโดเมนเรา (2026-08-24) |
| migration_173 | ตั้งเวลาตรวจรุ่น/firmware ซ้ำ (`model_detect_interval`) (2026-08-24) |
| migration_174 | ผู้รับ LINE เริ่มต้น (2026-08-24) |
| migration_175 | สวิตช์ส่ง LINE ของรายงาน face/lpr (2026-08-24) |
| migration_176 | **เพิ่มตาราง `storage_stats`** (2026-08-24) — ดู §3.18 |
| migration_177 | อายุไฟล์รายงาน PNG เป็น setting (`report_retention_days`) (2026-08-24) |
| migration_178 | `storage_stats`: นับ orphan ของภาพเหตุการณ์ (2026-08-24) |
| migration_179 | **เพิ่มตาราง `public_files`** — ที่ฝากไฟล์ที่แอดมินอัปโหลด (2026-08-24) — ดู §3.17 |
| migration_180 | โหมดเลือกกล้องต่อผู้ใช้ (`camera_select_mode`) (2026-08-27) |
| migration_181 | ตาข่ายกัน query ค้างระดับ role (`statement_timeout` guard) (2026-08-27) |
| migration_182 | ลด index ของตาราง `cameras` + เปิดทางให้ HOT update (2026-08-27) |
| migration_183 | `event_categories.stat_group` (2026-08-29) |
| migration_184 | index ครอบสำหรับตัวกรอง `object_class` ในหน้า Events (2026-08-30) |
| migration_185 | `carto_api_key` setting (2026-08-31) |
| migration_186 | `edge_status`: host spec (CPU, RAM, OS) (2026-08-31) |
| migration_187 | `alert_logs`: ผู้รับของแต่ละการแจ้งเตือน (2026-08-31) |
| migration_188 | `edge_status`: สถานะ "ขาดการติดต่อ" แบบคงทน (2026-08-31) |
| migration_189 | `sites.sort_order` — ลำดับการแสดง site (2026-08-31) |
| migration_190 | `idx_lpr_plate_type` — index ของตัวกรองประเภทรถในหน้า LPR (2026-08-31) |
| migration_191 | `PassengerCar` ของ Dahua คือรถบัส ไม่ใช่รถเก๋ง (backfill) (2026-08-31) |
| migration_192 | ถอน index ที่สร้างจากการวินิจฉัยผิด (`vtype`) (2026-08-31) |
| migration_193 | index ประกอบ (กล้อง, ประเภทรถ, เวลา) บน `license_plates` (2026-08-31) |
| migration_194 | `license_plates`: เลนและคนซ้อนท้ายเป็นคอลัมน์จริง (2026-09-01) |
| migration_195 | index ของเลนและคนซ้อนท้าย (2026-09-01) |
| migration_196 | login lockout knobs ใน `system_settings` (2026-09-03) |
| migration_197 | CR.5 — เพิ่ม report type `'summary'` (2026-09-03) |
| migration_198 | **ถอน index `idx_lpr_plate_type`** ที่ migration 190 สร้าง — ไม่มีใครใช้ (2026-09-06) |
| migration_199 | **`idx_events_anpr_noread_time`** — ดัชนีบางส่วนของแท็บ "ไม่ทราบทะเบียน" (2026-09-06) — ดู §3.3 |

> ช่วง 143–199 ไม่มีเลขขาด (ตรวจแล้ว 2026-09-06) · วันที่มาจาก commit แรกของแต่ละไฟล์
> (`git log --format=%ad --date=short -- <file> | tail -1`) — เป็นวันที่เขียนไฟล์ ไม่ใช่วันที่รันบน production

> **`edge_status`** (migration 067, edge monitoring): `site_id PK → sites(code)`, `last_seen_at`, `disk_free_gb`, `disk_total_gb`, `bridge_forwarded/dropped/remote/local`, `pm2_json JSONB`, **`snapshot_oldest DATE`**, **`snapshot_dirs INT`** (m.072), **`camera_broker_url TEXT`** (m.248 — LAN URL the site's Bosch cameras connect to, e.g. `mqtt://172.29.51.52:1883`; reported by `src/edge/bridge.js` heartbeat from that edge's `EDGE_CAMERA_BROKER_URL`; validated by `helpers/edgeCameraBrokerUrl.js` before storing; shown per-site in the camera form's MQTT credentials panel via `GET /api/cameras` `mqtt_broker_host`, admin-only). Upsert โดย `mqtt-subscriber.recordEdgeHeartbeat()` จาก edge heartbeat; snapshot fields (และ `camera_broker_url`) ใช้ COALESCE กัน NULL clobber.

---

<sub>End of REF_database-schema.md · Vigil Platform v1.5.4 · 2026-09-06</sub>
