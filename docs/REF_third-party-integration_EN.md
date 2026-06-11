<!-- ============================================================ -->
<!-- Vigil Platform — Third-Party Integration Guide (EN) -->
<!-- @copyright (c) 2025-2026 Prakasit Rochanavipart             -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Third-Party Database Integration Guide (English)

> **Audience:** Two distinct roles —
> 1. **Platform operators** (Sections 2–3, 8) provisioning database access for a new partner.
> 2. **3rd-party integration engineers** (Sections 4–7, 9–10) building dashboards or analytics on top of the platform's data.
>
> **Status:** Standalone reference — distribute freely to authorized 3rd parties.
> **Last updated:** 2026-06-08 · Schema baseline: migration 027
> **Companion document:** [REF_database-schema_EN.md](REF_database-schema_EN.md) — full table-by-table column reference.

---

## 1. Scope & Architecture

**Supported use case:** 3rd party pulls raw data from PostgreSQL over LAN to build a parallel dashboard, analytical view, or BI report.

```
+--------------------------------------------------------------+
|  Platform Server (LAN: 192.168.x.x)                          |
|                                                              |
|   +--------------+    +------------------+                   |
|   |  api-server  |--->|  PostgreSQL 16   |                   |
|   |   (vigil_sql)    |    |  vigil_platform      |                   |
|   +--------------+    |                  |                   |
|                       |  +------------+  |                   |
|                       |  | base tables|  |                   |
|                       |  +-----+------+  |                   |
|                       |        |         |                   |
|                       |        v         |                   |
|                       |  +------------+  |                   |
|                       |  | v_*_public |<-+--- 3rd party     |
|                       |  |   VIEWS    |  |     (read-only)  |
|                       |  +------------+  |                   |
|                       +------------------+                   |
+--------------------------------------------------------------+
        ^                                              ^
        | LAN                                          | LAN
        |                                              |
   +----+-----+                                  +-----+-----+
   | Platform |                                  | 3rd Party |
   | Dashboard|                                  | Dashboard |
   +----------+                                  +-----------+
```

**Boundaries:**
- 3rd parties see only **views** (`v_*_public`), never base tables.
- Views exclude: passwords, RTSP URLs, LINE secrets, session tokens, PII, internal raw payloads.
- Access is over LAN only — port 5432 must not be exposed to the public Internet.
- The role `third_party_readonly` is NOLOGIN — operators grant it to per-partner login users.

---

## 2. What's Exposed (View Catalog)

All views are prefixed `v_` and suffixed `_public`. They contain the same data volume as the underlying tables, but with a more stable schema contract.

| View | Source table | Excluded columns | Notes |
|---|---|---|---|
| `v_camera_groups_public` | `camera_groups` | — | All columns |
| `v_cameras_public` | `cameras` | `http_user`, `http_password`, `rtsp_url` | The three excluded columns contain camera credentials |
| `v_events_public` | `events` | `raw_json` | Main table — **largest**. Always filter by `event_time` |
| `v_appearances_public` | `appearances` | — | Person / vehicle attributes |
| `v_license_plates_public` | `license_plates` | — | **PDPA-protected** — requires Data Sharing Agreement |
| `v_alert_rules_public` | `alert_rules` | `recipient_ids`, `message_template` | Recipient IDs and templates are customer-specific |
| `v_alert_logs_public` | `alert_logs` | `message_text`, `error_message` | Summary log, no message content |
| `v_event_categories_public` | `event_categories` | — | Category definitions |
| `v_event_category_rules_public` | `event_category_rules` | — | Rule -> category mappings |
| `v_system_settings_public` | `system_settings` | Rows where `key` matches `line_%`, `license_%`, `secret_%`, `%_token`, `%_password` | Row-level filter (future-proof) |
| `v_report_history_public` | `report_history` | `file_path`, `recipients_sent`, `error_message` | Report send log |

### Tables NOT exposed via any view

| Table | Reason |
|---|---|
| `users` | Contains `password_hash` and PII |
| `sessions` | Contains active session tokens |
| `line_config` | Contains LINE channel token and ImgBB API key |
| `audit_log` | Contains PII and every user action (reserved for internal compliance) |
| `report_schedules` | Contains email recipients (PII) — use `v_report_history_public` instead |

---

## 3. Operator Setup — Provisioning a New Partner

### 3.1 Apply Migration

The migration is applied automatically when the platform's `api-server` starts. To run it manually:

```bash
docker exec -i vigil-postgres psql -U vigil_sql -d vigil_platform \
  < db/db_migration_027_third_party_views.sql
```

Verify success:

```sql
-- Inspect the role
\du third_party_readonly

-- List all public views
\dv v_*_public

-- Inspect grants
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'third_party_readonly';
```

### 3.2 Create a Login User per Partner

Naming convention: `<partner_slug>_ro` (e.g. `acme_corp_ro`, `building_a_bi_ro`).

```sql
CREATE USER acme_corp_ro WITH PASSWORD '<RANDOM_32_CHAR_PASSWORD>';

-- Grant the role (provides SELECT on all v_*_public views)
GRANT third_party_readonly TO acme_corp_ro;

-- Quotas: prevent heavy queries and pool exhaustion
ALTER USER acme_corp_ro SET statement_timeout = '60s';
ALTER USER acme_corp_ro SET lock_timeout = '5s';
ALTER USER acme_corp_ro SET idle_in_transaction_session_timeout = '30s';
ALTER USER acme_corp_ro CONNECTION LIMIT 5;

-- Tag application_name for audit/debug
ALTER USER acme_corp_ro SET application_name = 'acme_corp_dashboard';
```

> **Password generation:**
> `openssl rand -base64 32 | tr -d '/+=' | cut -c1-32`

### 3.3 Excluding License Plates (No DPA Signed)

If the partner has not signed a Data Sharing Agreement covering license plate data:

```sql
REVOKE SELECT ON v_license_plates_public FROM acme_corp_ro;
```

### 3.4 Restrict Network Access — pg_hba.conf

Edit `pg_hba.conf` inside the Postgres container (`/var/lib/postgresql/data/pg_hba.conf`) and add:

```conf
# 3rd-party read-only: LAN subnet only, scram-sha-256 auth
host    vigil_platform    acme_corp_ro    192.168.1.0/24    scram-sha-256
```

Reload:

```bash
docker exec vigil-postgres pg_ctl reload -D /var/lib/postgresql/data
```

### 3.5 Restrict Docker Port Binding (Important)

The default `docker-compose.yml` binds `5432:5432`, which listens on `0.0.0.0` — reachable from every network interface, including any with public connectivity.

Recommended: bind to a specific LAN interface.

```yaml
services:
  postgres:
    ports:
      - "192.168.1.10:5432:5432"   # bind only to the server's LAN IP
```

Or, when using Tailscale / WireGuard:

```yaml
      - "100.x.x.x:5432:5432"      # bind only to the Tailscale interface
```

> **Note:** Changing `docker-compose.yml` requires `docker compose up -d postgres` — brief downtime.

### 3.6 Enable SSL (Recommended for Remote LAN / VPN)

PostgreSQL 16 supports TLS out of the box. Add a certificate and enable in `postgresql.conf`:

```conf
ssl = on
ssl_cert_file = '/var/lib/postgresql/data/server.crt'
ssl_key_file  = '/var/lib/postgresql/data/server.key'
```

Then enforce in `pg_hba.conf` by using `hostssl` instead of `host`.

### 3.7 Query Auditing (Optional but Recommended)

```sql
-- Enable pg_stat_statements (built-in module)
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
-- Restart the container, then:
CREATE EXTENSION pg_stat_statements;

-- Inspect query patterns from the 3rd party
SELECT query, calls, total_exec_time, mean_exec_time
FROM pg_stat_statements
WHERE userid = (SELECT oid FROM pg_authid WHERE rolname = 'acme_corp_ro')
ORDER BY mean_exec_time DESC LIMIT 20;
```

---

## 4. Connection Guide (for the 3rd Party)

### 4.1 Connection Details (Example)

| Parameter | Value |
|---|---|
| Host | Provided by the operator (LAN IP or hostname) |
| Port | `5432` |
| Database | `vigil_platform` |
| Username | `<partner>_ro` |
| Password | Provided by the operator via a secure channel |
| SSL mode | `require` (if SSL is enabled) / `disable` (LAN without SSL) |

### 4.2 Connection Strings

**JDBC (Java / Kotlin / Scala):**
```
jdbc:postgresql://192.168.1.10:5432/vigil_platform?user=acme_corp_ro&password=...&sslmode=require&ApplicationName=acme_dashboard
```

**libpq URI (psql / Python / Node.js / Go):**
```
postgresql://acme_corp_ro:PASSWORD@192.168.1.10:5432/vigil_platform?sslmode=require&application_name=acme_dashboard
```

**Python (psycopg2 / psycopg3) — recommended pattern:**
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

**Node.js (pg / pg-pool):**
```javascript
const { Pool } = require('pg');
const pool = new Pool({
  host: '192.168.1.10',
  port: 5432,
  database: 'vigil_platform',
  user: 'acme_corp_ro',
  password: '...',
  ssl: { rejectUnauthorized: false },
  application_name: 'acme_dashboard',
  max: 5,                           // match CONNECTION LIMIT
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
```

**BI tools:** Metabase, Apache Superset, Grafana, Tableau, Power BI all support PostgreSQL natively — use the host/port/db/user/password values above directly.

### 4.3 Schema Discovery

```sql
-- List all views you can access
\dv v_*_public

-- Inspect a view's columns
\d+ v_events_public

-- Standard SQL (for BI tools that cannot run psql commands)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name LIKE 'v_%_public'
ORDER BY table_name, ordinal_position;

-- View descriptions (comments embedded by the migration)
SELECT relname, obj_description(oid, 'pg_class') AS description
FROM pg_class
WHERE relkind = 'v' AND relname LIKE 'v_%_public';
```

---

## 5. Query Patterns — Do's and Don'ts

### DO

```sql
-- Always include an event_time filter (uses index idx_events_time)
SELECT * FROM v_events_public
WHERE event_time >= NOW() - INTERVAL '7 days'
ORDER BY event_time DESC
LIMIT 1000;

-- Incremental polling — store the last seen event_id or event_time client-side
SELECT id, camera_id, event_time, event_type, rule_name, object_class
FROM v_events_public
WHERE event_time > '2026-05-27 08:00:00+07'   -- last_seen_event_time
ORDER BY event_time ASC
LIMIT 5000;

-- Aggregation that uses the (camera_id, event_time) index
SELECT camera_id, DATE(event_time AT TIME ZONE 'Asia/Bangkok') AS d, COUNT(*)
FROM v_events_public
WHERE event_time >= NOW() - INTERVAL '30 days'
GROUP BY camera_id, d;

-- View-to-view JOINs (PostgreSQL optimizes these)
SELECT e.event_time, c.name, e.event_type
FROM v_events_public e
JOIN v_cameras_public c ON c.id = e.camera_id
WHERE e.event_time >= NOW() - INTERVAL '1 hour';
```

### DON'T

```sql
-- Missing event_time filter = full table scan
SELECT * FROM v_events_public;

-- Aggressive polling (every 1 second) on the whole table
-- slows down the ingester. Ask the operator for WebSocket / LISTEN/NOTIFY
-- if you need true real-time.
SELECT * FROM v_events_public ORDER BY event_time DESC LIMIT 100;
-- (every second) = BAD

-- Deep OFFSET pagination still scans and discards rows
SELECT * FROM v_events_public ORDER BY event_time OFFSET 100000 LIMIT 100;
-- Use keyset pagination instead:
SELECT * FROM v_events_public
WHERE event_time < '<last_seen_event_time>'
ORDER BY event_time DESC LIMIT 100;

-- SELECT * on large tables when you only need a few columns
-- wastes network bandwidth and memory. List the columns explicitly.

-- Long-running transactions (idle in transaction)
-- block VACUUM and slow the database.
-- (The operator sets idle_in_transaction_session_timeout = 30s as a safeguard.)
```

### Recommended Polling Cadence

| Use case | Cadence | Method |
|---|---|---|
| Near-real-time dashboard | 5–10 seconds | Incremental (`event_time > last`) |
| Hourly aggregation | 1 hour | Full window query |
| Daily report | Once per day | Day range query |
| Sub-second real-time | — | **Not supported via DB polling** — request WebSocket / LISTEN integration |

---

## 6. Schema Evolution Policy

**Our commitment:**
- `v_*_public` views are a **public contract** — we will not drop columns or change types without notice.
- Base tables may change over time (via new migrations) — the views will be updated to preserve the public schema across minor versions.
- Any breaking change to a view will be announced at least **30 days in advance** and documented in the platform CHANGELOG (section "DB Schema (3rd party)").

**Your commitment (the 3rd party):**
- Write defensive queries: always list the columns you need in `SELECT` (never `SELECT *`) — that way, additive view changes do not affect your code.
- Subscribe to the CHANGELOG or request a notification channel from the operator.

---

## 7. Privacy & Data Sharing

| Data | Privacy category | Requires |
|---|---|---|
| `v_license_plates_public` (license plates) | Personal data under Thailand PDPA | **Signed Data Sharing Agreement (DPA)** with the site owner before access is granted |
| `v_appearances_public` (gender / age / clothing color) | Personal data (indirect) | Disclosure in the site's privacy notice |
| `v_cameras_public.location_label` (camera location) | Operationally sensitive | NDA |
| `v_events_public.snapshot_filename` | Reference only — image files reside on the platform's filesystem, not in the database | — |

> **Snapshot images** themselves are not exposed via the database. 3rd parties needing access to images must request a dedicated API endpoint from the operator (out of scope for this integration guide).

---

## 8. Operator Security Checklist

Before rolling out access to the first partner:

- [ ] Migration 027 applied successfully (`\dv v_*_public` shows all 11 views)
- [ ] Login user created with a strong password from `openssl rand` — never a memorable password
- [ ] `GRANT third_party_readonly TO <user>` verified
- [ ] `statement_timeout`, `idle_in_transaction_session_timeout`, `CONNECTION LIMIT` are set on the user
- [ ] `pg_hba.conf` restricts the user to the partner's subnet only
- [ ] Docker port binding is set to a specific LAN IP (not `0.0.0.0`)
- [ ] If access is non-LAN (e.g. remote site over VPN), SSL is enabled and `hostssl` is used in `pg_hba.conf`
- [ ] If granting `v_license_plates_public`, a DPA has been signed
- [ ] Credentials are delivered via a secure channel (password manager, encrypted email) — not regular chat
- [ ] Internal log records: who, when, why, expiry date (if applicable)
- [ ] (Optional) `pg_stat_statements` enabled for query auditing

---

## 9. Example Queries (for the 3rd Party)

```sql
-- 9.1 Camera status snapshot
SELECT
  c.id, c.name, c.location_label, g.name AS group_name,
  c.last_seen_at,
  CASE
    WHEN c.last_seen_at > NOW() - INTERVAL '5 minutes'  THEN 'online'
    WHEN c.last_seen_at > NOW() - INTERVAL '15 minutes' THEN 'stale'
    ELSE 'offline'
  END AS status
FROM v_cameras_public c
LEFT JOIN v_camera_groups_public g ON g.id = c.group_id
WHERE c.enabled = TRUE
ORDER BY c.name;


-- 9.2 Events per hour over the last 24 hours
SELECT
  date_trunc('hour', event_time AT TIME ZONE 'Asia/Bangkok') AS hour_local,
  COUNT(*) AS event_count,
  COUNT(DISTINCT camera_id) AS active_cameras
FROM v_events_public
WHERE event_time >= NOW() - INTERVAL '24 hours'
GROUP BY hour_local
ORDER BY hour_local;


-- 9.3 Top 10 cameras by event volume (last 7 days)
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


-- 9.4 People-counter total for today (local-day boundaries)
SELECT
  ec.name AS category,
  COUNT(*) AS count
FROM v_events_public e
JOIN v_event_category_rules_public ecr
  ON (ecr.camera_id    IS NULL OR ecr.camera_id    = e.camera_id)
 AND (ecr.rule_name    IS NULL OR ecr.rule_name    = e.rule_name)
 AND (ecr.event_type   IS NULL OR ecr.event_type   = e.event_type)
 AND (ecr.object_class IS NULL OR ecr.object_class = e.object_class)
JOIN v_event_categories_public ec ON ec.id = ecr.category_id
WHERE ec.kind = 'people_counter'
  AND e.event_time >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Bangkok')
                      AT TIME ZONE 'Asia/Bangkok'
GROUP BY ec.name;


-- 9.5 Alert delivery success rate (last 24 hours)
SELECT
  status,
  COUNT(*) AS count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM v_alert_logs_public
WHERE sent_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY count DESC;


-- 9.6 Incremental sync using keyset pagination
-- First call: capture max event_time from the result set
SELECT id, camera_id, event_time, event_type, rule_name, object_class
FROM v_events_public
WHERE event_time > '2026-05-27 08:00:00+07'   -- last_seen_event_time
ORDER BY event_time ASC, id ASC
LIMIT 5000;
-- Subsequent calls: use the last row's event_time as the cursor
```

---

## 10. FAQ / Troubleshooting

**Q: I see `permission denied for table cameras`.**
A: You queried a base table instead of a view. Use `v_cameras_public` rather than `cameras`. Only views are exposed.

**Q: My query fails with `canceling statement due to statement timeout`.**
A: The query exceeded the 60-second limit. Add an `event_time` filter or paginate. If you genuinely need a longer timeout, contact the operator to raise it for your user.

**Q: I get `too many connections for role`.**
A: You exceeded `CONNECTION LIMIT 5`. Use a connection pool on your end (pgbouncer, HikariCP, pg-pool) and right-size it.

**Q: I need snapshot images for events.**
A: The database stores only filenames, not image blobs. Images live on the platform's filesystem. Contact the operator for an API endpoint — image retrieval is out of scope for this database integration.

**Q: I need real-time push, not polling.**
A: PostgreSQL supports `LISTEN/NOTIFY`. The platform's `api-server` already publishes an `event_new` channel internally. Contact the operator to request a separate grant for `LISTEN` permission (not included in migration 027).

**Q: Can a new view be added?**
A: Yes — contact the operator. They will assess which columns are safe to expose and add a new migration (e.g. `db_migration_028_*`).

**Q: Why not use a read replica?**
A: At the platform's current scale (100–3,000 cameras), the operational overhead of a replica exceeds the benefit. If 3rd-party query load demonstrably impacts the ingester, the operator may revisit this.

---

## 11. Decommissioning (Removing Access)

```sql
-- Revoke role from a user
REVOKE third_party_readonly FROM acme_corp_ro;

-- Drop the user (removes grants and active sessions)
DROP USER acme_corp_ro;

-- To remove the entire feature (revoke from all users and drop the role):
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_authid
    WHERE oid IN (
      SELECT member FROM pg_auth_members
      WHERE roleid = (SELECT oid FROM pg_authid WHERE rolname = 'third_party_readonly')
    )
  LOOP
    EXECUTE format('REVOKE third_party_readonly FROM %I', r.rolname);
  END LOOP;
END $$;
DROP ROLE third_party_readonly;

-- Optionally drop the views (usually harmless to leave them in place)
DROP VIEW IF EXISTS
  v_camera_groups_public, v_cameras_public, v_events_public,
  v_appearances_public, v_license_plates_public,
  v_alert_rules_public, v_alert_logs_public,
  v_event_categories_public, v_event_category_rules_public,
  v_system_settings_public, v_report_history_public;
```

---

<sub>End of REF_third-party-integration_EN.md · Vigil Platform · 2026-06-08</sub>
