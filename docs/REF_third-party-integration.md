<!-- ============================================================ -->
<!-- Vigil Platform — Third-Party DB Integration Guide   -->
<!-- @author Prakasit Rochanavipart (Dojo-mAn)                   -->
<!-- @copyright (c) 2025-2026 All Rights Reserved.               -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Third-Party Database Integration Guide

> **Audience:** ฝ่าย ops ของเรา (Section 2–3, 8) + ทีม integration ของ 3rd party (Section 4–7, 9–10)
> Last updated: **2026-08-07** · Schema baseline: migration 027 → **123**
> Pre-req docs: [REF_database-schema.md](REF_database-schema.md) — schema reference เต็ม

---

## 0. มี 2 ทาง — อ่านให้ถูกทางก่อน

> เพิ่ม 2026-08-07 · เอกสารนี้เขียนขึ้นตอนที่มีทางเดียว จึงต้องแยกให้ชัด

| | **ก · HTTP API `/v1`** ⭐ ทางหลัก | **ข · ต่อ Postgres ตรง** ทางเดิม |
|---|---|---|
| partner ทำอะไร | เรียก REST + เซ็น AK/SK | เปิด connection มาที่ Postgres |
| เห็น Postgres ไหม | **ไม่เลย** | เห็น |
| ยืนยันตัวตน | ลายเซ็น HMAC ต่อ request | user/password ของ DB |
| คุมสิทธิ์ | column GRANT (เหมือนกัน) + จำกัดไซต์ + จำกัดย้อนหลัง | column GRANT อย่างเดียว |
| ต้องอยู่วง LAN/VPN ไหม | ไม่ | **ใช่** |
| จำกัดจำนวนคำขอ · หมดอายุ · audit | ✅ มีครบ | ❌ ไม่มี |
| เอกสารให้ partner | `GET /v1/openapi.json` generate เอง | เอกสารนี้ |
| ตั้งค่ายังไง | `partner-admin.js` + หน้า `ตั้งค่า › เชื่อมต่อภายนอก` | §3 ของเอกสารนี้ |
| สเปกเต็ม | [`SPEC_partner-api_2026-08-07.md`](SPEC_partner-api_2026-08-07.md) | เอกสารนี้ |

**ทางที่ควรใช้คือ ก** — ทาง ข เก็บไว้สำหรับกรณีที่ partner อยู่ในวงเดียวกันจริง ๆ และต้องการ SQL ดิบ
**§3 · §4 · §9 เขียนไว้สำหรับทาง ข** — ถ้าทำทาง ก ให้ข้ามไปอ่าน §2 (มีอะไรให้บ้าง) · §7 (PDPA) · §8 (checklist ฉบับใหม่)

---

## 1. Scope & Architecture

**Use case ที่รองรับ:** 3rd party ดึง raw data จาก PostgreSQL ผ่าน LAN เพื่อสร้าง dashboard / analytics ของตัวเอง
> ⚠️ ย่อหน้านี้และ §3–§4 อธิบาย**ทาง ข** เท่านั้น — ดู §0

```
┌──────────────────────────────────────────────────────────────┐
│  Our Server (LAN: 192.168.x.x)                               │
│                                                              │
│   ┌──────────────┐    ┌──────────────────┐                   │
│   │  api-server  │───▶│  PostgreSQL 16   │                   │
│   │   (vigil_sql)    │    │  vigil_platform      │                   │
│   └──────────────┘    │                  │                   │
│                       │  ┌────────────┐  │                   │
│                       │  │ base tables│  │                   │
│                       │  └─────┬──────┘  │                   │
│                       │        ▼         │                   │
│                       │  ┌────────────┐  │                   │
│                       │  │ v_*_public │◀─┼─── 3rd party     │
│                       │  │   VIEWS    │  │     (read-only)  │
│                       │  └────────────┘  │                   │
│                       └──────────────────┘                   │
└──────────────────────────────────────────────────────────────┘
        ▲                                              ▲
        │ LAN                                          │ LAN
        │                                              │
   ┌────┴─────┐                                  ┌─────┴─────┐
   │ Dashboard│                                  │ 3rd Party │
   │ (ours)   │                                  │ Dashboard │
   └──────────┘                                  └───────────┘
```

**Boundaries:**
- 3rd party เห็นเฉพาะ **VIEW** (`v_*_public`) ไม่ใช่ base table
- VIEW exclude: passwords, RTSP URLs, LINE secrets, session tokens, PII, internal raw payloads
- Access ผ่าน LAN เท่านั้น — ไม่ expose port 5432 ออก internet
- Role `third_party_readonly` = NOLOGIN — ops grant ให้ login user เป็นรายๆ
- ⚠️ **ตั้งแต่ 2026-10-21 (migration 268) แนวทางคือ "ให้ตามความจำเป็น":** partner ไม่เห็นว่าขออะไรได้ เราออกแบบชุดข้อมูลให้เอง ·
  **ให้สิทธิ์รายคอลัมน์เท่านั้น** (`GRANT SELECT (col, ...) ON v_x TO role`) — `GRANT third_party_readonly` หรือ `GRANT SELECT ON view`
  ครอบคลุมคอลัมน์ที่จะเพิ่มใน view ในอนาคตด้วย (ทดสอบจริง) ⇒ ฟิลด์ใหม่หลุดถึง partner โดยไม่มีใครติ๊ก ·
  partner ผ่าน API: สร้างจากหน้า ตั้งค่า › เชื่อมต่อภายนอก (เริ่มที่ 0 คอลัมน์) แล้วติ๊กชุดข้อมูล
  **REST (`/v1`) ตัดรายฟิลด์** (ระยะ 2 ขั้น 1): endpoint SELECT เฉพาะคอลัมน์ที่ role ถือสิทธิ์จริง — ฟิลด์ที่ไม่ได้สิทธิ์หายจากแถวและจาก `/v1/openapi.json` (ไม่ใช่ null) ·
  ขาดคอลัมน์บังคับ (`requiredColumns` ใน `partnerSchema.js`: id / เวลา / camera_id · ค้นหาป้ายเพิ่ม plate_number) = 403 ทั้ง endpoint · สิทธิ์ที่แก้มีผลภายใน 10 วินาที (แคช)
  **ทะเบียนข้อตกลง** (migration 269, แท็บ "ข้อตกลงข้อมูล"): บันทึกเป็นเวอร์ชัน — วัตถุประสงค์ · ฐานทางกฎหมาย (PDPA) · อ้างอิง DPA · ผู้อนุมัติ · ใช้ได้ถึง · ครบทบทวน (ค่าเริ่มต้น +90 วัน) พร้อมภาพสิทธิ์คอลัมน์ ณ ตอนบันทึก · หน้าจอเตือนเมื่อสิทธิ์ปัจจุบันไม่ตรงเวอร์ชันล่าสุด หรือถึงกำหนดทบทวน · partner ไม่เห็นตารางนี้
  **ยามเฝ้า partner** (`src/helpers/partnerWatch.js`, ทุกวัน 08:30): LINE ถึงผู้รับ `perf_alert` เท่านั้น เมื่อ — ไม่มีข้อตกลงเกิน 7 วัน · ข้อตกลงหมดแต่ยัง active · ครบทบทวนภายใน 14 วัน/เลยกำหนด · credential หมดใน 14 วัน · คำขอ 24 ชม. > 5 เท่าค่ากลาง 7 วันและ > 500 · 403 ≥ 20 · 401 (key ที่รู้จัก) ≥ 20 · 429 ≥ 10 · IP ใหม่ (ไม่เคยเห็นใน 30 วัน) · เกณฑ์ปรับได้ที่ `line_config.perf_alert.partner_watch` · cooldown ข้อตกลง 7 วัน / การใช้งาน 24 ชม. · ผลล่าสุดอยู่ `system_settings.partner_watch` · ร้องอย่างเดียว ไม่ตัดสิทธิ์ใคร
  **สถิติ (S1, migration 270)** — view สรุปที่ติ๊กได้ในหมวด "สถิติ": `v_vehicle_stats_hourly_public` → `GET /v1/stats/vehicles/hourly` (hour_start, camera_id, vehicles, by_type) · `v_lpr_stats_hourly_public` → `/v1/stats/lpr/hourly` (detections, no_plate) · `v_lpr_stats_daily_public` → `/v1/stats/lpr/daily` (day ตามเวลาไทย, region / vehicle_type / vehicle_brand / plate_color เป็นคอลัมน์แยก ให้สิทธิ์แยกได้) · **ตัวนับดิบเท่านั้น ไม่มีอัตรา** · ประเภทรถ/สีป้ายเป็นรหัสดิบจากกล้อง · ชั่วโมง/วันล่าสุดเปลี่ยนได้จนถึง reconcile 05:00 (ดู `updated_at`) · traffic เก็บ 120 วัน · cursor `i` = camera_id · ชื่อคอลัมน์ของ view = สัญญา `/v1` ห้ามเปลี่ยน
  **Traffic Enforcement (S2, migration 271)** — หมวด "บังคับใช้กฎจราจร": `v_enforcement_hourly_public` → `GET /v1/enforcement/hourly` (no_helmet, no_helmet_with_plate, no_seatbelt, riders3 + `by_type` ตัวหารและความผิดแยกประเภทรถ ไม่ใส่ค่า 0) · `v_enforcement_cameras_public` → `/v1/enforcement/cameras` (reports_no_helmet / no_seatbelt / riders3 = เคยรายงานใน 120 วัน · false ≠ ไม่มีคนผิด) · **ตัวเลขบนหน้าจอเรา = `by_type.twoWheelVehicle.no_helmet_with_plate`** (ยอดรวมแถวรวม 3 ล้อด้วย) · รายวัน `v_enforcement_daily_public` → `/v1/enforcement/daily` (migration 275 ทับ `traffic_daily_stats` · วันไทย) · ไม่ส่งผู้ทำผิดซ้ำรายป้าย · ไม่ส่งอัตรา
  **สีรถ (S3, migration 272)** — `vehicle_color` เป็นมิติรายวันของตัวเอง (คอลัมน์ใหม่ใน `v_lpr_stats_daily_public` ไม่ได้ GRANT ให้ใคร) · ตัวสรุป `refreshLprDims()` เขียนทุก 15 นาที · ย้อนหลังเติมด้วย `node scripts/backfill-lpr-rollups.js --dims-only --days <n>` (วัดวันละ ~2 วิ · มิติเดิมยอดไม่เปลี่ยน)
  **ชุดเริ่มต้นสำหรับ partner** — `docs/partner-kit/` (README อังกฤษ + client Python/Node ไม่มี dependency · ทดสอบกับโค้ด partner-api จริง 2026-10-22) · ตัวอย่างอ่าน endpoint จาก `/v1/openapi.json` ของ partner เอง **ไม่ระบุชื่อ endpoint ตายตัว** ตามหลักให้ตามความจำเป็น — ส่งให้ partner ได้ทั้งโฟลเดอร์
  **ทางเข้า DB ของ partner มีทางเดียว** — `partner-api.partnerQuery()` และ preview ใช้ `helpers/asPartnerRole.js` ตัวเดียว (รวมสำเนา 2026-10-22 · เทสต์ `test/partner-role-single-path.test.js`)
  **ฟิลด์รายแถวเพิ่ม (ขั้น 2, migration 273)** — ทำรอไว้ (ไม่ GRANT ให้ใคร): `v_license_plates_public` + vehicle_type, vehicle_color, vehicle_brand, plate_type, plate_color, no_helmet, rider_count, no_seatbelt, lane · `v_appearances_public` + mask, hat, expression (จาก rj_*), bag_category, overall_color, hair_color · **age_group = COALESCE(age_group, rj_age_group)** (เดิมว่าง 100% · partner ที่ได้ age_group อยู่แล้วจะเริ่มเห็นค่า) · ค่าเป็นคำของกล้องเอง ต่างยี่ห้อต่างคำ · `no_helmet`/`no_seatbelt` = false ได้แม้กล้องตรวจไม่ได้ (เขียนในสัญญาแล้ว)
  **`traffic_daily_stats` (migration 274)** — ผลรวม `traffic_hourly_stats` ต่อวันไทย เขียนโดย `refreshTrafficDaily()` ในรอบ 15 นาที + reconcile · prune 120+1 วัน · backfill `scripts/backfill-traffic-daily.js` · หน้า Traffic อ่านอนุกรมรายวัน 120 วันจากตารางนี้ (ผลเท่าเดิมทุกแถว · 1,308 → 48 ms / 209 → 28 ms) · วันแรกของอนุกรมเป็นวันไทยเต็มวัน (เดิมขาด 7 ชม.แรก · เจ้าของเลือก 2026-10-22)
  **สถิติคน (migration 276 ตาราง · 277 view)** — `appearance_dim_daily` (วันไทยตาม `event_time` เหมือนหน้าจอสถิติคน × กล้อง × มิติ × ค่า) · `object_class` นับทุกประเภท (ตัวหาร) · เพศ / อายุ (COALESCE rj_age_group) / สีเสื้อ-กางเกง / ประเภทเสื้อ-กางเกง / แว่น / หมวก / หน้ากาก / สีหน้า / กระเป๋า นับเฉพาะ Person · ไม่นับค่าว่าง · **เก็บ 365 วัน** (ข้อมูลดิบ 40) · `refreshAppearanceDims()` รอบ 15 นาที (~0.4 วิ) + reconcile ทีละวันไทย · backfill `scripts/backfill-appearance-dims.js` · `v_person_stats_daily_public` → `GET /v1/stats/person/daily` (หมวด "สถิติ")

---

## 2. What's Exposed (View Catalog)

ทุก view มี prefix `v_` และ suffix `_public` — ขนาดข้อมูลเท่ากับ base table แต่ schema นิ่งกว่า

| View | Source table | Excluded columns | Notes |
|---|---|---|---|
| `v_camera_groups_public` | `camera_groups` | — | ทุก column |
| `v_cameras_public` | `cameras` | credentials (`http_user`/`http_password`/`rtsp_url`) **+ ตั้งแต่ migration 120:** `ip_address` · `http_port` · `mqtt_topic_prefix` · `serial_number` · `firmware` · `enable_*` · `clip_*_sec` | **เพิ่ม `site_id`** · เดิมกันแค่ credential แต่ยังปล่อย IP ภายในจริง (`10.11.100.17`) = แผนผังเครือข่าย ไม่ใช่ข้อมูล integration — ดู decision #228 |
| `v_events_public` | `events` | `raw_json` | ตารางหลัก — **ใหญ่สุด** ต้อง filter `event_time` เสมอ |
| `v_appearances_public` | `appearances` | — | person/vehicle attributes |
| `v_license_plates_public` | `license_plates` | — | 🔴 **PDPA-gated** — ต้องมี DPA |
| `v_alert_rules_public` | `alert_rules` | `recipient_ids`, `message_template` | recipient ID/template เป็น customer-specific |
| `v_alert_logs_public` | `alert_logs` | `message_text`, `error_message` | log แบบ summary, ไม่มี content |
| `v_event_categories_public` | `event_categories` | — | category mapping |
| `v_event_category_rules_public` | `event_category_rules` | — | rule → category |
| `v_system_settings_public` | `system_settings` | **ทุก key ยกเว้น 5 ตัวที่อนุญาต** (`brand_name`, `display_timezone`, `data_retention_days`, `lpr_retention_days`, `appearances_retention_days`) | allowlist (migration 268) — เดิมเป็น denylist แล้วหลุด `carto_api_key`, `perf_watch` ฯลฯ · เพิ่ม key ต้องแก้ view โดยตั้งใจ |
| `v_report_history_public` | `report_history` | `file_path`, `recipients_sent`, `error_message` | log การส่ง report |

### Tables ที่ไม่ expose ผ่าน view ใดๆ

| Table | เหตุผล |
|---|---|
| `users` | มี `password_hash`, PII |
| `sessions` | มี active session tokens |
| `line_config` | มี LINE channel token + imgbb API key |
| `audit_log` | PII + ทุก action ของ user (สงวนสำหรับ compliance ภายใน) |
| `report_schedules` | มี email recipients (PII) — ใช้ `v_report_history_public` แทน |

---

## 3. Ops Setup — เปิดให้ 3rd Party Access

### 3.1 รัน migration

Migration ถูก apply อัตโนมัติเมื่อ `api-server` start ขึ้น (`src/migrate.js`). ถ้าต้องการ force รันด้วยมือ:

```bash
docker exec -i vigil-postgres psql -U vigil_sql -d vigil_platform \
  < db/db_migration_027_third_party_views.sql
```

ตรวจว่าสำเร็จ:

```sql
-- ดู role
\du third_party_readonly

-- ดู views ทั้งหมด
\dv v_*_public

-- ดู grants
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'third_party_readonly';
```

### 3.2 สร้าง login user สำหรับ 3rd party (1 user / 1 partner)

```sql
-- Naming convention: <partner_slug>_ro (เช่น acme_corp_ro, building_a_bi_ro)
CREATE USER acme_corp_ro WITH PASSWORD '<RANDOM_32_CHAR_PASSWORD>';

-- ⚠️ ห้าม GRANT third_party_readonly (ได้ทั้ง view + คอลัมน์อนาคต) — ให้รายคอลัมน์ตามชุดข้อมูลที่อนุมัติ (migration 268)
GRANT USAGE ON SCHEMA public TO acme_corp_ro;
GRANT SELECT (id, camera_id, plate_number, detected_at) ON v_license_plates_public TO acme_corp_ro;   -- ตัวอย่าง

-- Quota: ป้องกัน query หนัก + pool exhaust
ALTER USER acme_corp_ro SET statement_timeout = '60s';
ALTER USER acme_corp_ro SET lock_timeout = '5s';
ALTER USER acme_corp_ro SET idle_in_transaction_session_timeout = '30s';
ALTER USER acme_corp_ro CONNECTION LIMIT 5;

-- Tag application_name สำหรับ debug (3rd party ตั้งใน connection string ก็ได้)
ALTER USER acme_corp_ro SET application_name = 'acme_corp_dashboard';
```

> **Password generation:**
> `openssl rand -base64 32 | tr -d '/+=' | cut -c1-32`

### 3.3 ถ้าไม่ต้องการให้เห็น license plates (no DPA)

```sql
-- Revoke เฉพาะ view license plates หลังจาก grant role
REVOKE SELECT ON v_license_plates_public FROM acme_corp_ro;
```

### 3.4 จำกัด network — pg_hba.conf

แก้ `pg_hba.conf` ใน Postgres container (path: `/var/lib/postgresql/data/pg_hba.conf`) เพิ่มบรรทัด:

```conf
# 3rd party read-only: LAN subnet only, scram-sha-256 auth
host    vigil_platform    acme_corp_ro    192.168.1.0/24    scram-sha-256
```

แล้ว reload:

```bash
docker exec vigil-postgres pg_ctl reload -D /var/lib/postgresql/data
```

### 3.5 จำกัด docker port binding (สำคัญ — ปัจจุบัน bind ทุก interface)

ใน `docker-compose.yml` ปัจจุบัน `"5432:5432"` = bind `0.0.0.0` → เข้าถึงได้จากทุก network interface
รวมถึง interface ที่ออก internet

แนะนำเปลี่ยนเป็น LAN interface เฉพาะ:

```yaml
services:
  postgres:
    ports:
      - "192.168.1.10:5432:5432"   # bind เฉพาะ LAN IP ของ server
```

หรือถ้าใช้ Tailscale/WireGuard:

```yaml
      - "100.x.x.x:5432:5432"      # bind เฉพาะ Tailscale interface
```

> ⚠️ การเปลี่ยน `docker-compose.yml` ต้อง `docker compose up -d postgres` ใหม่ — มี downtime สั้นๆ

### 3.6 เปิด SSL (แนะนำสำหรับ remote LAN / VPN)

PostgreSQL 16 รองรับ TLS in-the-box — เพิ่ม cert + เปิดใน `postgresql.conf`:

```conf
ssl = on
ssl_cert_file = '/var/lib/postgresql/data/server.crt'
ssl_key_file  = '/var/lib/postgresql/data/server.key'
```

แล้วบังคับใน pg_hba.conf ใช้ `hostssl` แทน `host`

### 3.7 Audit (optional แต่แนะนำ)

```sql
-- เปิด pg_stat_statements (built-in)
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
-- แล้ว restart container
-- จากนั้น CREATE EXTENSION pg_stat_statements ใน vigil_platform

-- ดู query ที่ 3rd party ยิงเข้ามาบ่อย/ช้า
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements
WHERE userid = (SELECT oid FROM pg_authid WHERE rolname = 'acme_corp_ro')
ORDER BY mean_exec_time DESC LIMIT 20;
```

---

## 4. Connection Guide (สำหรับ 3rd Party)

### 4.1 Connection details (ตัวอย่าง)

| Parameter | Value |
|---|---|
| Host | `<ที่ ops แจ้ง — LAN IP / hostname>` |
| Port | `5432` |
| Database | `vigil_platform` |
| Username | `<partner>_ro` |
| Password | `<ที่ ops ส่งให้ผ่าน secure channel>` |
| SSL mode | `require` (ถ้า ops เปิด SSL) / `disable` (LAN ไม่มี SSL) |

### 4.2 Connection string

**JDBC (Java/Kotlin/Scala):**
```
jdbc:postgresql://192.168.1.10:5432/vigil_platform?user=acme_corp_ro&password=...&sslmode=require&ApplicationName=acme_dashboard
```

**libpq URI (psql / Python psycopg / Node pg / Go pgx):**
```
postgresql://acme_corp_ro:PASSWORD@192.168.1.10:5432/vigil_platform?sslmode=require&application_name=acme_dashboard
```

**Python (psycopg2/psycopg3) — recommended pattern:**
```python
import psycopg
conn = psycopg.connect(
    host="192.168.1.10", port=5432, dbname="vigil_platform",
    user="acme_corp_ro", password="...",
    sslmode="require",
    application_name="acme_dashboard",
    connect_timeout=10,
)
```

**BI tools:** Metabase / Apache Superset / Grafana / Tableau / Power BI ทุกตัวรองรับ PostgreSQL native — ใช้ค่า host/port/db/user/password ข้างต้นได้ตรงๆ

### 4.3 Schema discovery

```sql
-- ดู view ทั้งหมดที่เข้าถึงได้
\dv v_*_public

-- ดู column ของ view
\d+ v_events_public

-- ดูแบบ standard SQL (สำหรับ BI tool ที่ไม่รัน psql command)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name LIKE 'v_%_public'
ORDER BY table_name, ordinal_position;

-- ดู description ของ view (comment ที่ migration เขียนไว้)
SELECT relname, obj_description(oid, 'pg_class') AS description
FROM pg_class
WHERE relkind = 'v' AND relname LIKE 'v_%_public';
```

---

## 5. Query Patterns — Do's & Don'ts

### ✅ DO

```sql
-- ✅ ใส่ filter event_time เสมอ (ใช้ index idx_events_time)
SELECT * FROM v_events_public
WHERE event_time >= NOW() - INTERVAL '7 days'
ORDER BY event_time DESC
LIMIT 1000;

-- ✅ Incremental polling — เก็บ last_seen event_id หรือ event_time ฝั่ง client
SELECT id, camera_id, event_time, event_type, rule_name, object_class
FROM v_events_public
WHERE event_time > '2026-05-27 08:00:00+07'   -- last seen
ORDER BY event_time ASC
LIMIT 5000;

-- ✅ Aggregation ผ่าน index (camera_id, event_time)
SELECT camera_id, DATE(event_time AT TIME ZONE 'Asia/Bangkok') AS d, COUNT(*)
FROM v_events_public
WHERE event_time >= NOW() - INTERVAL '30 days'
GROUP BY camera_id, d;

-- ✅ JOIN view → view (PostgreSQL optimize ได้)
SELECT e.event_time, c.name, e.event_type
FROM v_events_public e
JOIN v_cameras_public c ON c.id = e.camera_id
WHERE e.event_time >= NOW() - INTERVAL '1 hour';
```

### ❌ DON'T

```sql
-- ❌ ไม่มี event_time filter — full table scan
SELECT * FROM v_events_public;

-- ❌ Polling แบบ aggressive (ทุก 1 วินาที ทั้งตาราง)
-- → ทำให้ ingester ของเราช้า. ถ้าต้องการ realtime
-- คุยกับ ops ขอ WebSocket/LISTEN-NOTIFY แทน
SELECT * FROM v_events_public ORDER BY event_time DESC LIMIT 100;
-- ทุก 1 วินาที = ❌

-- ❌ OFFSET ลึก (PostgreSQL ยัง scan + discard)
SELECT * FROM v_events_public ORDER BY event_time OFFSET 100000 LIMIT 100;
-- ใช้ keyset pagination แทน:
SELECT * FROM v_events_public
WHERE event_time < '<last_seen_event_time>'
ORDER BY event_time DESC LIMIT 100;

-- ❌ SELECT * บน table ใหญ่ที่ไม่จำเป็น
-- → ดึง column เยอะกินทั้ง network + memory
-- ระบุ column ที่ใช้จริง

-- ❌ Long-running transaction (idle in transaction)
-- → block VACUUM, ลาก DB ช้า
-- (ops set idle_in_transaction_session_timeout = 30s ป้องกันไว้)
```

### Polling cadence ที่แนะนำ

| Use case | Cadence | Method |
|---|---|---|
| Near-realtime dashboard | 5–10 วินาที | Incremental (`event_time > last`) |
| Hourly aggregation | 1 ชั่วโมง | Full window query |
| Daily report | 1 ครั้ง/วัน | Day range query |
| Sub-second realtime | — | ❌ ไม่รองรับผ่าน DB polling — request WebSocket/LISTEN integration |

---

## 6. Change Policy (Schema Evolution)

**Commitment ของเรา:**
- View `v_*_public` คือ **public contract** — เราจะไม่ลบ column หรือเปลี่ยน type โดยไม่แจ้งล่วงหน้า
- Base table อาจเปลี่ยนแปลงได้ตลอด (migration ใหม่) — view จะถูก update ให้คง schema เดิมไว้ในรอบ minor version
- ถ้าจำเป็นต้องเปลี่ยน view schema (breaking) → แจ้งล่วงหน้าอย่างน้อย **30 วัน** + ระบุใน [CHANGELOG.md](../CHANGELOG.md) section "DB Schema (3rd party)"

**Commitment ของ 3rd party:**
- เขียน defensive query: ระบุ column ที่ใช้ใน `SELECT` เสมอ (ไม่ใช้ `SELECT *`) → กรณีเราเพิ่ม column ใหม่จะไม่กระทบ
- Subscribe CHANGELOG.md หรือขอ notification channel กับ ops

---

## 7. PDPA / Data Sharing

| ข้อมูล | PDPA category | ต้องมี |
|---|---|---|
| `v_license_plates_public` (ทะเบียนรถ) | ข้อมูลส่วนบุคคล | **Data Sharing Agreement (DPA)** กับเจ้าของพื้นที่ก่อน grant |
| `v_appearances_public` (เพศ/อายุ/สี) | ข้อมูลส่วนบุคคล (less direct) | แจ้งใน privacy notice ของ site นั้น |
| `v_cameras_public.location_label` (ตำแหน่งกล้อง) | sensitive (operational security) | NDA |
| `v_events_public.snapshot_filename` | reference เท่านั้น — ไฟล์รูปอยู่ที่ filesystem ของเรา ไม่ได้ expose ผ่าน DB | — |

**Snapshot images (จริงๆ):** ไม่ได้ expose ผ่าน DB. 3rd party ที่ต้องการรูปต้องขอ API endpoint แยก (`/api/events/:id/snapshot` ต้อง auth ของ dashboard) — **ไม่ใช่ scope ของ integration นี้**

---

## 8. Security Checklist (Ops)

> **แก้ครั้งใหญ่ 2026-08-07** — ของเดิมเขียนไว้ตอนที่แผนคือ **ให้ partner ต่อ Postgres ตรง**
> (`pg_hba` · docker port binding · `hostssl` · login user ต่อราย) แต่ **เราไม่ได้ทำแบบนั้น**
> สิ่งที่สร้างจริงคือ **HTTP API `/v1` + AK/SK signing** (decision #227–#233)
> — partner ไม่เคยเห็น Postgres เลย · ข้อที่ล้าสมัยถูกตัดออก ไม่ใช่เก็บไว้ให้คนไล่ตามของที่ไม่มีอยู่

### 8.1 ก่อนสร้าง partner รายแรก (ครั้งเดียว)

- [x] role `third_party_readonly` มีอยู่ + grant ครบ 11 view — ✅ migration 118 (เคยหายไปจริง)
- [x] `statement_timeout` ต่อ query ของ partner — ✅ 5 วินาที ใน `partnerQuery()` (decision #230)
- [x] retention ของ `api_request_log` — ✅ `api_log_retention_days` = 90 (decision #231)
- [x] `CAMERA_SECRET_KEY` ตั้งแล้ว — จำเป็น เพราะ `app_secret` เก็บแบบเข้ารหัส · **ไม่มี key = สร้าง partner ไม่ได้** (CLI ปฏิเสธ)
- [ ] **ตัดสินโดเมนก่อนเปิด tunnel** — แยก `api.` หรือใช้ `dashboard.` เดิม · แก้ทีหลังแพงกว่า (§8.3 ของสเปก)

### 8.2 ทุกครั้งที่สร้าง partner

```bash
node src/partner-admin.js create <slug> "<ชื่อที่แสดง>" [--sites hkt] [--days 30|60|90|120|180|365]
```

- [ ] **`--days`** — ไม่ใส่ = ไม่มีวันหมดอายุ · ควรผูกกับอายุสัญญาเสมอ (migration 123)
- [ ] **`--sites`** — จำกัดไซต์ถ้า partner ไม่ควรเห็นทั้งฟลีต · ตรวจผลได้จากหน้าจอทันที
- [ ] **`max_lookback_days`** — ย้อนหลังได้กี่วันตามสัญญา (`UPDATE api_consumers SET max_lookback_days=…`)
- [ ] **`rate_per_min`** — default 60 (เผื่อ 118 เท่าของการใช้งานปกติ) · ตั้งสูงชั่วคราวถ้าต้อง backfill ครั้งแรก
- [ ] **ส่ง App Secret ทาง channel ที่ส่งรหัสผ่านได้** — CLI แสดงครั้งเดียว อ่านคืนไม่ได้ ลืมแล้วต้อง `rotate`
- [ ] **จำกัดคอลัมน์** ที่ `ตั้งค่า › เชื่อมต่อภายนอก` ถ้า partner ไม่ควรเห็นทุกฟิลด์
- [ ] 🔴 **ถ้าจะให้ `v_license_plates_public`** — ดู §7 · ต้องมีการอนุญาตจากเจ้าของข้อมูล
      · ยังไม่พร้อม → **ปิดไว้ก่อนได้ เปิดทีหลังคลิกเดียว** ไม่ต้องรอทุกอย่างพร้อมพร้อมกัน
- [ ] บันทึกใน `notes`: ใคร ทำไม อ้างอิงสัญญาอะไร

### 8.3 ตรวจหลังสร้าง

- [ ] ให้ partner ยิง `GET /v1/healthz` — 200 พิสูจน์พร้อมกันว่า**เซ็นถูก**และ**role ใช้ได้จริง**
- [ ] เปิดหน้า `เชื่อมต่อภายนอก` ดูว่าคอลัมน์ที่เห็นตรงกับที่ตั้งใจ
- [ ] ส่ง `GET /v1/openapi.json` ให้ partner — generate จากสิทธิ์จริงของเขา ไม่ต้องเขียนเอกสารเอง

### 8.4 ดูเป็นระยะ

- [ ] **partner ที่ใกล้หมดอายุ** — การ์ดขึ้นเตือนเองเมื่อเหลือ ≤14 วัน · ต่ออายุ `extend <slug> --days N`
- [ ] **`key ที่ไม่รู้จักพยายามเข้า`** บนหน้าจอ — ไม่ได้แปลว่าถูกโจมตีเสมอ (partner ที่กำลัง debug ก็ทำให้ขึ้น) แต่ไม่มีที่อื่นให้ดู
- [ ] **partner ที่สร้างแล้วไม่เคยเรียก** — `เรียกล่าสุด: ยังไม่เคย` = สิทธิ์ที่แจกแล้วไม่มีใครใช้ ควรถอน
- [ ] **`role หาย`** — คำขอของ partner รายนั้นล้มทุกครั้ง (สภาพเดียวกับที่ migration 118 แก้)

### 8.5 ถอนสิทธิ์

```bash
node src/partner-admin.js revoke <slug>      # มีผลทันที คำขอถัดไปได้ 401
```
- [ ] `DROP ROLE <slug>_ro` ตอนสะดวก — **แถวใน `api_consumers` ห้ามลบ** เพราะ `api_request_log` อ้างถึง
- [ ] ถ้าแค่ secret รั่ว → `rotate <slug>` พอ (key เดิมตายทันที · อายุสัญญาไม่ถูกรีเซ็ต)

---

## 9. Example Queries (สำหรับ 3rd Party)

```sql
-- ── 9.1 Camera status snapshot ──────────────────────────────
SELECT
  c.id, c.name, c.location_label, g.name AS group_name,
  c.last_seen_at,
  CASE
    WHEN c.last_seen_at > NOW() - INTERVAL '5 minutes' THEN 'online'
    WHEN c.last_seen_at > NOW() - INTERVAL '15 minutes' THEN 'stale'
    ELSE 'offline'
  END AS status
FROM v_cameras_public c
LEFT JOIN v_camera_groups_public g ON g.id = c.group_id
WHERE c.enabled = TRUE
ORDER BY c.name;


-- ── 9.2 Events ต่อชั่วโมง 24 ชม. ที่ผ่านมา ──────────────────
SELECT
  date_trunc('hour', event_time AT TIME ZONE 'Asia/Bangkok') AS hour_bkk,
  COUNT(*) AS event_count,
  COUNT(DISTINCT camera_id) AS active_cameras
FROM v_events_public
WHERE event_time >= NOW() - INTERVAL '24 hours'
GROUP BY hour_bkk
ORDER BY hour_bkk;


-- ── 9.3 Top 10 cameras by event volume (7 days) ─────────────
SELECT
  e.camera_id, c.name,
  COUNT(*) AS event_count,
  COUNT(*) FILTER (WHERE e.object_class = 'Person')  AS person_events,
  COUNT(*) FILTER (WHERE e.object_class = 'Vehicle') AS vehicle_events
FROM v_events_public e
LEFT JOIN v_cameras_public c ON c.id = e.camera_id
WHERE e.event_time >= NOW() - INTERVAL '7 days'
GROUP BY e.camera_id, c.name
ORDER BY event_count DESC
LIMIT 10;


-- ── 9.4 People counter ของวันนี้ (Bangkok day) ──────────────
SELECT
  ec.name AS category,
  COUNT(*) AS count
FROM v_events_public e
JOIN v_event_category_rules_public ecr
  ON (ecr.camera_id IS NULL OR ecr.camera_id = e.camera_id)
 AND (ecr.rule_name IS NULL OR ecr.rule_name = e.rule_name)
 AND (ecr.event_type IS NULL OR ecr.event_type = e.event_type)
 AND (ecr.object_class IS NULL OR ecr.object_class = e.object_class)
JOIN v_event_categories_public ec ON ec.id = ecr.category_id
WHERE ec.kind = 'people_counter'
  AND e.event_time >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Bangkok')
                      AT TIME ZONE 'Asia/Bangkok'
GROUP BY ec.name;


-- ── 9.5 Alert delivery success rate (24 ชม.) ─────────────────
SELECT
  status,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM v_alert_logs_public
WHERE sent_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY count DESC;


-- ── 9.6 Incremental sync (keyset pagination) ─────────────────
-- รอบแรก: เก็บ max event_time ที่ดึงมา
SELECT id, camera_id, event_time, event_type, rule_name, object_class
FROM v_events_public
WHERE event_time > '2026-05-27 08:00:00+07'   -- last_seen_event_time
ORDER BY event_time ASC, id ASC
LIMIT 5000;
-- รอบถัดไป: ใช้ event_time ของ row สุดท้ายเป็น cursor
```

---

## 10. FAQ / Troubleshooting

**Q: เห็น error `permission denied for table cameras`**
A: 3rd party query ตรงเข้า base table แทน view. ใช้ `v_cameras_public` แทน `cameras` (เห็นเฉพาะ view)

**Q: Query ขึ้น `canceling statement due to statement timeout`**
A: Query เกิน 60s — เพิ่ม `event_time` filter หรือ paginate. ถ้าจำเป็นจริงๆ ขอ ops ปรับ `statement_timeout` ของ user

**Q: ขึ้น `too many connections for role`**
A: เกิน `CONNECTION LIMIT 5` — ใช้ connection pool (pgbouncer / HikariCP / pg-pool) ฝั่ง 3rd party

**Q: ต้องการ snapshot image ของ event**
A: DB ไม่มี blob — เก็บแค่ filename. รูปอยู่ที่ filesystem ของ server เรา. ต้องคุยกับ ops ขอ API access (out of scope ของ doc นี้)

**Q: ต้องการ realtime push (ไม่ poll)**
A: PostgreSQL มี `LISTEN/NOTIFY` — api-server เรา publish `event_new` channel อยู่แล้ว (`src/api-server.js:913`). คุยกับ ops ขอ grant `LISTEN` permission แยก (ไม่อยู่ใน migration 027)

**Q: เพิ่ม view ใหม่ได้ไหม**
A: ติดต่อ ops — เราจะ assess sensitive column แล้ว add ใน migration ใหม่ (เช่น `db_migration_028_...`)

**Q: ทำไมไม่ใช้ replica แทน?**
A: Scale ปัจจุบัน (100–3,000 กล้อง) read replica overhead เกินจำเป็น. ถ้า workload จาก 3rd party ทำให้ ingester ช้าจริง → revisit ตอนนั้น

---

## 11. Decommissioning (เลิกใช้)

```sql
-- Revoke role from user
REVOKE third_party_readonly FROM acme_corp_ro;

-- Drop user (ลบทั้ง grants + session)
DROP USER acme_corp_ro;

-- ถ้าต้องการลบ role ทั้งหมด (เลิกใช้ feature ทั้งระบบ):
DO $$
DECLARE r record;
BEGIN
  -- revoke จาก users ทั้งหมดก่อน
  FOR r IN SELECT rolname FROM pg_authid
           WHERE oid IN (SELECT member FROM pg_auth_members
                          WHERE roleid = (SELECT oid FROM pg_authid WHERE rolname = 'third_party_readonly'))
  LOOP
    EXECUTE format('REVOKE third_party_readonly FROM %I', r.rolname);
  END LOOP;
END $$;
DROP ROLE third_party_readonly;

-- ลบ views (ถ้าจำเป็น — ปกติทิ้งไว้ก็ไม่กระทบ)
DROP VIEW IF EXISTS
  v_camera_groups_public, v_cameras_public, v_events_public,
  v_appearances_public, v_license_plates_public,
  v_alert_rules_public, v_alert_logs_public,
  v_event_categories_public, v_event_category_rules_public,
  v_system_settings_public, v_report_history_public;
```

---

<sub>End of REF_third-party-integration.md · Vigil Platform v1.5.0 · 2026-06-08</sub>
