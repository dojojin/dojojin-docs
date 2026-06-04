<!-- ============================================================ -->
<!-- DojoJin Tech Dashboard — Third-Party DB Integration Guide   -->
<!-- @author Prakasit Rochanavipart (Dojo-mAn)                   -->
<!-- @copyright (c) 2025-2026 All Rights Reserved.               -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Third-Party Database Integration Guide

> **Audience:** ฝ่าย ops ของเรา (Section 2–3, 8) + ทีม integration ของ 3rd party (Section 4–7, 9–10)
> Last updated: 2026-05-27 · Schema baseline: migration 027
> Pre-req docs: [REF_database-schema.md](REF_database-schema.md) — schema reference เต็ม

---

## 1. Scope & Architecture

**Use case ที่รองรับ:** 3rd party ดึง raw data จาก PostgreSQL ผ่าน LAN เพื่อสร้าง dashboard / analytics ของตัวเอง

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

---

## 2. What's Exposed (View Catalog)

ทุก view มี prefix `v_` และ suffix `_public` — ขนาดข้อมูลเท่ากับ base table แต่ schema นิ่งกว่า

| View | Source table | Excluded columns | Notes |
|---|---|---|---|
| `v_camera_groups_public` | `camera_groups` | — | ทุก column |
| `v_cameras_public` | `cameras` | `http_user`, `http_password`, `rtsp_url` | ⚠️ 3 column นี้มี credentials กล้อง |
| `v_events_public` | `events` | `raw_json` | ตารางหลัก — **ใหญ่สุด** ต้อง filter `event_time` เสมอ |
| `v_appearances_public` | `appearances` | — | person/vehicle attributes |
| `v_license_plates_public` | `license_plates` | — | 🔴 **PDPA-gated** — ต้องมี DPA |
| `v_alert_rules_public` | `alert_rules` | `recipient_ids`, `message_template` | recipient ID/template เป็น customer-specific |
| `v_alert_logs_public` | `alert_logs` | `message_text`, `error_message` | log แบบ summary, ไม่มี content |
| `v_event_categories_public` | `event_categories` | — | category mapping |
| `v_event_category_rules_public` | `event_category_rules` | — | rule → category |
| `v_system_settings_public` | `system_settings` | rows ที่ key match `line_%`, `license_%`, `secret_%`, `%_token`, `%_password` | filter ที่ row level (future-proof) |
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

-- Grant role (ให้สิทธิ์อ่าน views ทั้งหมด)
GRANT third_party_readonly TO acme_corp_ro;

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

ก่อน rollout ให้ 3rd party คนแรก:

- [ ] Migration 027 apply สำเร็จ (`\dv v_*_public` เห็นครบ 11 view)
- [ ] Login user สร้างแล้ว, password generated by `openssl rand`, ไม่ใช่ค่าจำได้
- [ ] `GRANT third_party_readonly TO <user>` ตรวจสอบแล้ว
- [ ] `statement_timeout`, `idle_in_transaction_session_timeout`, `CONNECTION LIMIT` ตั้งแล้ว
- [ ] pg_hba.conf จำกัด subnet ของ 3rd party เท่านั้น
- [ ] Docker port binding เป็น LAN IP เฉพาะ (ไม่ใช่ `0.0.0.0`)
- [ ] ถ้าไม่ใช่ direct LAN (เช่น remote site ผ่าน VPN) → เปิด SSL + `hostssl` ใน pg_hba
- [ ] DPA signed ถ้า grant `v_license_plates_public`
- [ ] ส่ง credential ผ่าน secure channel (1Password / encrypted email) ไม่ใช่ chat ทั่วไป
- [ ] Document ใน internal log: who, when, why, expiry date (ถ้ามี)
- [ ] (Optional) เปิด `pg_stat_statements` เพื่อ audit query

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

<sub>End of REF_third-party-integration.md · DojoJin Tech Dashboard v1.5.0 · 2026-05-27</sub>
