<!-- ============================================================ -->
<!-- Vigil Platform — Database Schema Reference (EN)     -->
<!-- @copyright (c) 2025-2026 Prakasit Rochanavipart             -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Database Schema Reference (English)

> **Audience:** External partners, DBAs, and integration engineers who need to understand the database structure of the Vigil Platform platform.
>
> **Status:** Standalone reference — distribute freely to authorized 3rd parties.
> **Last updated:** 2026-06-08 · Schema baseline: migration 027
> **Companion document:** [REF_third-party-integration_EN.md](REF_third-party-integration_EN.md) — connection setup, query patterns, security checklist.

---

## About This Document

The Vigil Platform is a self-hosted CCTV analytics platform that ingests events from IP cameras (Bosch, Hikvision, Dahua, ONVIF) via MQTT, stores them in PostgreSQL, and provides operational dashboards, scheduled reports, and LINE-based alerts.

This document describes the PostgreSQL database that backs the platform — table-by-table column definitions, indexes, retention behavior, and security/PII annotations — so 3rd parties can:

- Build analytical dashboards on top of the same dataset,
- Integrate with BI tools (Metabase, Superset, Grafana, Tableau, Power BI, etc.),
- Perform DBA-level operations (backup, capacity planning, schema review).

> **For connection setup and query best practices, see the companion document `REF_third-party-integration_EN.md`.** This file is the schema reference only.

---

## 1. Connection Details

| Parameter | Value | Notes |
|---|---|---|
| Engine | PostgreSQL 16 (Alpine) | Docker image `postgres:16-alpine` |
| Host (Docker internal) | `postgres` (Docker service name) | Inside the platform's Docker network |
| Host (external) | LAN IP / hostname (ask the platform operator) | |
| Port | `5432` | Standard PostgreSQL port |
| Database | `vigil_platform` | |
| **Default username** | `vigil_sql` | DB owner, used internally by the platform — **NOT** for 3rd-party access. See Section 5. |
| Server timezone | UTC (enforced) | All `TIMESTAMPTZ` columns store UTC. The display timezone (`Asia/Bangkok`, UTC+7) is applied client-side. |
| SSL | Off by default | Operator may enable SSL for remote access. |

> **Important:** 3rd parties must NOT use the `vigil_sql` account. The platform operator provisions a dedicated read-only user (see Section 5 and the companion integration guide).

---

## 2. Tables Overview

```
Database: vigil_platform (schema: public)

Camera & Events
   camera_groups           Logical grouping of cameras
   cameras                 Camera definitions and online status
   events                  All IVA events (largest table)
   appearances             Person/vehicle attributes per event
   license_plates          License plate recognition (LPR) data

Alert System
   line_config             LINE Messaging API credentials (single row)
   alert_rules             Notification rules
   alert_logs              Audit log of every notification attempt

Authentication
   users                   Platform user accounts
   sessions                Active session tokens
   audit_log               Audit trail of all user actions

Analytics & System
   event_categories        Analytics categories (custom + built-in)
   event_category_rules    Mapping rule -> category
   system_settings         Key/value settings and white-label branding
   report_schedules        Recurring report delivery configuration
   report_history          Log of every report send
```

Total: **16 tables** (plus internal `schema_migrations` for migration tracking).

---

## 3. Table Schemas (Detailed)

### 3.1 `camera_groups`
Logical grouping of cameras for dashboard filtering.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) NOT NULL | Group display name |
| `color` | VARCHAR(7) | Hex color for UI badges — default `#5B8DEF` |
| `description` | TEXT | |
| `sort_order` | INT | UI ordering |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |

---

### 3.2 `cameras`
Camera definitions, network configuration, and online status.

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(100) PK | Matches MQTT topic prefix, e.g. `BoschCam1` |
| `name` | VARCHAR(150) | Display name |
| `description` | TEXT | |
| `ip_address` | VARCHAR(45) | IPv4 or IPv6 |
| `http_port` | INT | Default 80 |
| `http_user` | VARCHAR(50) | **SENSITIVE** — HTTP username for the camera |
| `http_password` | TEXT | **SENSITIVE** — HTTP password (stored as plaintext on disk) |
| `rtsp_url` | TEXT | **SENSITIVE** — may embed RTSP credentials |
| `mqtt_topic_prefix` | VARCHAR(150) | e.g. `BoschCam1/` |
| `model` | VARCHAR(100) | e.g. `FlexiDome 8100i` |
| `firmware` | VARCHAR(50) | |
| `serial_number` | VARCHAR(100) | |
| `latitude` | DOUBLE PRECISION | GPS coordinate |
| `longitude` | DOUBLE PRECISION | GPS coordinate |
| `location_label` | VARCHAR(255) | Human-readable location |
| `group_id` | INT FK -> `camera_groups` | |
| `enabled` | BOOLEAN | |
| `last_seen_at` | TIMESTAMPTZ | Last MQTT heartbeat |
| `last_event_at` | TIMESTAMPTZ | Last received event |
| `enable_snapshot` | BOOLEAN | Whether to fetch snapshot on alarm |
| `enable_vca_overlay` | BOOLEAN | Snapshot with IVA bounding box overlay |
| `enable_clip_capture` | BOOLEAN | 24/7 RTSP buffer + dump on alarm |
| `clip_pre_sec` | INT | Pre-alarm window (1..60) |
| `clip_post_sec` | INT | Post-alarm window (0..30) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:** `group_id`, `enabled`, `last_seen_at DESC`

---

### 3.3 `events`
**The main table.** Every IVA event received from any camera via the MQTT ingester.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `camera_id` | VARCHAR(100) | **No FK** — events can arrive before the camera is registered |
| `event_time` | TIMESTAMPTZ NOT NULL | Camera-side timestamp (UTC) |
| `received_at` | TIMESTAMPTZ | Subscriber receive time (UTC) |
| `event_type` | VARCHAR(50) | e.g. `Crossing line 1`, `Object In Field`, `Loitering` |
| `event_category` | VARCHAR(50) | `RuleEngine` / `VideoSource` / `Device` / `Behavior` |
| `event_state` | VARCHAR(20) | `active` / `inactive` / `single` |
| `rule_name` | VARCHAR(150) | Name of the IVA rule that triggered |
| `object_id` | VARCHAR(50) | Tracked object ID |
| `object_class` | VARCHAR(30) | `Person` / `Vehicle` / `Bicycle` / `Animal` |
| `likelihood` | REAL | Confidence score 0.0–1.0 |
| `snapshot_filename` | VARCHAR(255) | Relative path to saved image |
| `has_snapshot` | BOOLEAN | |
| `clip_file` | TEXT | Video clip filename |
| `clip_status` | VARCHAR(16) | `pending` / `done` / `failed` |
| `clip_duration_sec` | REAL | Actual capture duration |
| `raw_json` | JSONB | **INTERNAL** — raw MQTT payload (excluded from 3rd-party views) |

**Indexes:** `camera_id`, `event_time DESC`, `event_type`, `rule_name`, `object_class`, `(camera_id, event_time DESC)`, partial indexes filtered on `has_snapshot`, GIN on `raw_json`

> **Data volume:** At 100 cameras, expect 5M–50M rows/year depending on event frequency.
> Default retention: **365 days** (configurable via `system_settings.data_retention_days`)

---

### 3.4 `appearances`
Person and vehicle attributes per event (sourced from Bosch IVA Pro and equivalent analytics).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK -> `events` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(100) | Denormalized for query convenience |
| `object_id` | VARCHAR(50) | |
| `object_class` | VARCHAR(30) | `Person` / `Vehicle` |
| `gender` | VARCHAR(20) | `male` / `female` / null |
| `age_group` | VARCHAR(20) | `child` / `adult` / `senior` / null |
| `upper_color` | VARCHAR(30) | Upper clothing color |
| `lower_color` | VARCHAR(30) | Lower clothing color |
| `vehicle_type` | VARCHAR(30) | `car` / `truck` / `motorcycle` |
| `vehicle_color` | VARCHAR(30) | |
| `confidence` | REAL | |
| `attributes` | JSONB | Additional attributes |
| `detected_at` | TIMESTAMPTZ | |

---

### 3.5 `license_plates`
License plate recognition (LPR) data.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK -> `events` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(100) | |
| `plate_number` | VARCHAR(20) | Plate text |
| `confidence` | REAL | |
| `country` | VARCHAR(10) | ISO-2 (`TH`, `MY`, etc.) |
| `region` | VARCHAR(50) | Province / state |
| `bbox_x/y/width/height` | INT | Bounding box (optional) |
| `detected_at` | TIMESTAMPTZ | |

> **Privacy notice:** License plates are personally identifiable data under Thailand's PDPA (analogous to GDPR). 3rd-party access requires a signed Data Sharing Agreement.

---

### 3.6 `line_config`
LINE Messaging API credentials — **single-row table** (enforced by CHECK constraint on `id = 1`).

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK DEFAULT 1 | |
| `channel_access_token` | TEXT | **SECRET** — LINE channel access token |
| `channel_secret` | TEXT | **SECRET** — LINE channel secret |
| `imgbb_api_key` | TEXT | **SECRET** — ImgBB upload API key |
| `oa_basic_id` | TEXT | LINE Official Account `@basicId` |
| `enabled` | BOOLEAN | |
| `recipients` | JSONB | `[{type, id, name, enabled}]` — LINE user/group IDs |
| `updated_at` | TIMESTAMPTZ | |

> **NEVER expose this table to 3rd parties** — contains API credentials.

---

### 3.7 `alert_rules`
Notification rule definitions (for LINE delivery).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | Rule name |
| `enabled` | BOOLEAN | |
| `camera_ids` | TEXT[] | Empty array = all cameras |
| `rule_names` | TEXT[] | Empty array = all IVA rules |
| `recipient_ids` | TEXT[] | **INTERNAL** — LINE recipient IDs |
| `cooldown_seconds` | INT | Anti-flood (default 60s) |
| `send_snapshot` | BOOLEAN | Attach snapshot image |
| `message_template` | TEXT | **INTERNAL** — template with `{camera}`, `{rule}`, `{time}`, `{object_class}` placeholders |
| `active_from` | TIME | Start of active window (null = 24/7) |
| `active_to` | TIME | End of active window |
| `last_triggered_at` | TIMESTAMPTZ | |
| `trigger_count` | INT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.8 `alert_logs`
Audit log of every LINE notification attempt.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `rule_id` | INT FK -> `alert_rules` ON DELETE SET NULL | |
| `rule_name` | VARCHAR(150) | Snapshot at send time (preserved if rule is later deleted) |
| `event_id` | BIGINT | Reference to `events` (no FK) |
| `camera_id` | VARCHAR(100) | |
| `triggered_rule` | VARCHAR(150) | The IVA rule that triggered the alert |
| `event_time` | TIMESTAMPTZ | |
| `status` | VARCHAR(20) | `success` / `failed` / `cooldown_skip` / `no_recipients` / `disabled` / `quiet_hours_skip` |
| `message_text` | TEXT | **INTERNAL** — rendered message body |
| `recipient_count` | INT | |
| `error_message` | TEXT | **INTERNAL** — error from LINE API |
| `duration_ms` | INT | LINE API response time |
| `sent_at` | TIMESTAMPTZ | |

**Retention:** Automatically purged after **90 days** by the `cleanup_old_data()` function.

---

### 3.9 `users`
Platform user accounts (these are NOT PostgreSQL roles — they live inside the application).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `username` | VARCHAR(50) UNIQUE | |
| `email` | VARCHAR(100) UNIQUE | |
| `full_name` | VARCHAR(150) | |
| `password_hash` | TEXT | **SECRET** — bcrypt hash (cost factor 10) |
| `role` | VARCHAR(20) | `admin` / `viewer` / `auditor` |
| `enabled` | BOOLEAN | |
| `must_change_password` | BOOLEAN | Forces password reset on next login |
| `last_login_at` | TIMESTAMPTZ | |
| `last_login_ip` | VARCHAR(45) | **PII** — login IP address |
| `failed_attempts` | INT | Consecutive failed login count |
| `locked_until` | TIMESTAMPTZ | Account lockout timestamp |
| `created_at` / `updated_at` | TIMESTAMPTZ | |
| `created_by` | INT FK -> `users` | |

> **NEVER expose this table to 3rd parties** — contains credentials and PII.

---

### 3.10 `sessions`
Active session tokens.

| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(64) PK | Random hex session ID |
| `user_id` | INT FK -> `users` ON DELETE CASCADE | |
| `ip_address` | VARCHAR(45) | **PII** |
| `user_agent` | TEXT | |
| `created_at` / `expires_at` / `last_used_at` | TIMESTAMPTZ | |
| `revoked` | BOOLEAN | |

**Retention:** Automatically purged when `expires_at < NOW()` or `revoked = true`.

> **NEVER expose this table to 3rd parties** — contains active authentication tokens.

---

### 3.11 `audit_log`
Audit trail of all user actions.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `user_id` | INT FK -> `users` ON DELETE SET NULL | |
| `username` | VARCHAR(50) | Snapshot (preserved even if user is deleted) |
| `action` | VARCHAR(50) | `login_success`, `login_failed`, `login_locked`, `logout`, `password_change`, `user_create`, `user_update`, `user_delete`, `session_revoke`, etc. |
| `target_user_id` / `target_username` | INT / VARCHAR | If action affects another user |
| `target_camera_id` | TEXT | If action affects a camera |
| `ip_address` | VARCHAR(45) | **PII** |
| `user_agent` | TEXT | |
| `details` | JSONB | Action-specific details |
| `created_at` | TIMESTAMPTZ | |

**Retention:** Automatically purged after **90 days**.

---

### 3.12 `event_categories`
Analytics categories (custom + built-in, locked).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(100) UNIQUE | |
| `icon` | VARCHAR(20) | Icon identifier |
| `color` | VARCHAR(20) | Hex color |
| `kind` | VARCHAR(20) | `event` / `people_counter` / `vehicle_counter` |
| `is_builtin` | BOOLEAN | True = cannot be renamed/deleted |
| `sort_order` | INT | |

**Built-in rows:** `People Counting` (id=1), `Vehicle Counting` (id=2).

---

### 3.13 `event_category_rules`
Mapping rules (event → category), used by the stats engine.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `category_id` | INT FK -> `event_categories` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(80) | NULL = all cameras |
| `rule_name` | VARCHAR(200) | NULL = all rules |
| `event_type` | VARCHAR(80) | NULL = all types |
| `object_class` | VARCHAR(40) | NULL = all classes |
| `match_state` | VARCHAR(10) | Default `true` |
| `priority` | INT | |

---

### 3.14 `system_settings`
Key/value store for platform settings and white-label branding.

| Key | Default | Description |
|---|---|---|
| `data_retention_days` | `365` | Days of events to keep (max 730) |
| `snapshot_retention_days` | `30` | Days of snapshot images to keep on disk (max 365) |
| `display_timezone` | `Asia/Bangkok` | Timezone for date boundaries |
| `counter_dedup_mode` | `state` | `state` / `object_window` / `none` |
| `comparison_mode` | `rolling` | `rolling` / `calendar` |
| `custom_range_max_days` | `365` | Max span for custom date range picker |
| `analytics_event_display` | CSV of camera-automation types | Event types shown in the live feed |
| `brand_name` | `Vigil Platform` | Product name (white-label) |
| `brand_tagline` | `CCTV Analytics Suite` | Subtitle |
| `brand_logo_path` | `` (empty) | Logo file path |
| `brand_primary_color` | `#5b8def` | Primary accent color |

Schema: `key VARCHAR(80) PK`, `value TEXT`, `description TEXT`, `updated_at TIMESTAMPTZ`

---

### 3.15 `report_schedules`
Recurring report delivery configuration.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `report_type` | VARCHAR(16) | `daily` / `weekly` / `monthly` |
| `enabled` | BOOLEAN | |
| `send_time` | TIME | Time of day to fire (in `display_timezone`) |
| `recipients` | TEXT | CSV of email addresses (**PII**) |
| `last_run_at` | TIMESTAMPTZ | Prevents same-day double-fire |
| `last_status` | VARCHAR(24) | `success` / `failed` / `pending` / null |
| `last_error` | TEXT | |

---

### 3.16 `report_history`
Audit log of every report send.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `schedule_id` | INT FK -> `report_schedules` ON DELETE SET NULL | |
| `report_type` | VARCHAR(16) | |
| `range_from` / `range_to` | TIMESTAMPTZ | Report time range |
| `image_layout` | VARCHAR(12) | Layout used |
| `file_path` | TEXT | **INTERNAL** — file path on the server |
| `recipients_sent` | TEXT | **PII** — CSV of emails actually delivered |
| `sent_count` / `total_recipients` | INT | |
| `status` | VARCHAR(24) | `success` / `failed` |
| `error_message` | TEXT | **INTERNAL** — error/stack trace |
| `created_at` | TIMESTAMPTZ | |

---

## 4. Stored Functions & Triggers

| Name | Type | Description |
|---|---|---|
| `trigger_set_updated_at()` | FUNCTION | Auto-updates `updated_at` before UPDATE |
| `cleanup_old_data()` | FUNCTION | Purges expired sessions, audit_log > 90 days, alert_logs > 90 days. Called hourly by the application. |
| `trg_*_updated` | TRIGGER | Applies `trigger_set_updated_at()` to tables with an `updated_at` column |

---

## 5. PostgreSQL Users & Roles

| Name | Type | Used by | Notes |
|---|---|---|---|
| `vigil_sql` | Login user / DB owner | Platform internals (API server, MQTT ingester, migration runner) | Created by the deployment — **not for 3rd-party use** |
| `third_party_readonly` | **Role** (NOLOGIN) | Granted to 3rd-party login users | Created by migration 027 — has `SELECT` on `v_*_public` views only |
| `<partner>_ro` | Login user | 3rd party (BI tool, partner dashboard) | Created by the operator per partner; granted `third_party_readonly`. See companion integration guide. |

### Default Application User

| Username | Role | Created by | Notes |
|---|---|---|---|
| `admin` | `admin` | Application on first startup (if `users` table is empty) | Default password `changeme`, `must_change_password = true` — the operator changes this immediately. |

Application roles (inside the `users` table, NOT PostgreSQL roles):
- `admin` — full access
- `viewer` — read-only UI
- `auditor` — view-all + settings, no write

---

## 6. Database Access for 3rd Parties

> **Canonical guide:** [REF_third-party-integration_EN.md](REF_third-party-integration_EN.md) covers the full setup procedure, view catalog, query patterns, PDPA compliance, security checklist, and decommissioning.
>
> The summary below is for quick reference only.

### 6.1 Access Pattern — Read-only Role + Stable Views

Migration `db_migration_027_third_party_views.sql` creates:

- **Role** `third_party_readonly` (NOLOGIN) — granted to login users by the operator
- **Views** `v_*_public` (11 views) — exclude sensitive columns (passwords, secrets, PII, raw payloads)

3rd parties query through views only, never base tables. The view layer decouples partner contracts from base-table schema evolution.

### 6.2 Quick Start (Operator)

```sql
-- 1. Create login user
CREATE USER acme_corp_ro WITH PASSWORD '<random>';

-- 2. Grant the role
GRANT third_party_readonly TO acme_corp_ro;

-- 3. Set quotas
ALTER USER acme_corp_ro SET statement_timeout = '60s';
ALTER USER acme_corp_ro CONNECTION LIMIT 5;
```

See the companion integration guide §3 for pg_hba.conf, Docker port binding, SSL, and audit setup.

### 6.3 Sample Connection String

```
postgresql://acme_corp_ro:PASSWORD@<LAN_IP>:5432/vigil_platform?sslmode=require&application_name=acme_dashboard
```

### 6.4 Tables: 3rd-Party Access Matrix

| Table | Safe? | Notes |
|---|---|---|
| `camera_groups` | YES | General data |
| `cameras` | PARTIAL | **Must exclude** `http_password`, `rtsp_url`, `http_user` — credentials |
| `events` | YES | Main dataset — large |
| `appearances` | YES | |
| `license_plates` | **CONDITIONAL** | **PDPA-protected** — requires Data Sharing Agreement |
| `alert_rules` | PARTIAL | Exclude `recipient_ids`, `message_template` |
| `alert_logs` | PARTIAL | Exclude `message_text`, `error_message` |
| `event_categories` | YES | |
| `event_category_rules` | YES | |
| `system_settings` | PARTIAL | Branding + config; filter out any future `*_token`, `*_password` keys |
| `report_history` | PARTIAL | Exclude `file_path`, `recipients_sent`, `error_message` |
| `report_schedules` | PARTIAL | Contains email addresses (PII) |
| `users` | **NEVER** | Contains `password_hash` and PII |
| `sessions` | **NEVER** | Contains active session tokens |
| `line_config` | **NEVER** | Contains LINE API secret and ImgBB key |
| `audit_log` | **NEVER** | Contains PII (IP, user actions) |

> The `v_*_public` views handle these exclusions automatically. 3rd parties should query views, not base tables.

---

## 7. What 3rd Parties Need to Know

### 7.1 Timezone Handling
- All `TIMESTAMPTZ` columns are stored in **UTC**.
- Convert to local time client-side: `event_time AT TIME ZONE 'Asia/Bangkok'`
- The platform's display timezone is `Asia/Bangkok` (UTC+7) by default.

### 7.2 `cameras.id` Is a String, Not Integer
- `camera_id` columns in `events`, `appearances`, `license_plates`, `alert_logs` are `VARCHAR(100)`.
- Examples: `"BoschCam1"`, `"Hik-Front-01"` — matches the camera's MQTT topic prefix.
- `events.camera_id` has **no FK** to `cameras` — events can arrive before camera registration. Expect a few orphan `camera_id` values in `events`.

### 7.3 Data Volume Expectations
- `events` is the largest table — always filter by `event_time` and rely on indexes.
- `raw_json` in `events` contains the raw MQTT payload (GIN-indexed). The 3rd-party view excludes this column.
- `appearances` is proportional to `events` (0 to N rows per event).
- Default retention: events = 365 days, snapshots = 30 days.

### 7.4 Idempotent Migrations
- Migration files (`db_migration_*.sql`) are idempotent and safe to re-run.
- The platform's migration runner applies pending migrations on startup, tracked in `schema_migrations`.

### 7.5 Automatic Cleanup
- `cleanup_old_data()` runs hourly:
  - Deletes expired/revoked sessions
  - Deletes audit_log entries older than 90 days
  - Deletes alert_logs entries older than 90 days
- `events` is purged separately by the application using `data_retention_days`.

---

## 8. Impact & Risk Analysis

### 8.1 Security Risks

| Risk | Severity | Detail |
|---|---|---|
| Credential leakage | **Critical** | `cameras.http_password`, `cameras.rtsp_url`, `line_config.*_token/secret`, `users.password_hash`, `sessions.id` — if exposed, an attacker can access cameras, the LINE OA, or impersonate users. |
| Personal data exposure | **Critical** | `license_plates.plate_number`, `users.email`, `audit_log.ip_address` — protected under Thailand PDPA (analogous to GDPR). Requires a Data Sharing Agreement before granting access. |
| Unauthorized writes | **High** | Granting the `vigil_sql` user (DB owner) to 3rd parties allows them to delete events, modify alert rules, or inject fake records. Always use the read-only role. |
| Network exposure | **High** | Port 5432 bound to `0.0.0.0` is reachable from any network interface. Restrict to LAN-only via Docker port binding or firewall. |
| No SSL by default | Medium | DB connections are unencrypted unless SSL is explicitly enabled — credentials traverse the network in plaintext if accessed remotely. |

### 8.2 Performance Risks

| Risk | Severity | Detail |
|---|---|---|
| Unfiltered `events` queries | **High** | Queries without an `event_time` filter perform a table scan over millions of rows, slowing the live ingester. |
| Connection pool exhaustion | Medium | The platform's `pg.Pool` has no explicit cap — 3rd parties without their own pool can monopolize connections. |
| Lock contention | Medium | Heavy analytical queries running alongside the ingester's inserts can cause lock waits. |

### 8.3 Recommended Mitigations

1. **Create a dedicated read-only user** (do not share the `vigil_sql` account).
2. **Grant only what is needed** — use the `third_party_readonly` role and the `v_*_public` views.
3. **Bind PostgreSQL to a specific LAN interface** in `docker-compose.yml` (not `0.0.0.0`).
4. **Enable SSL** if access traverses an untrusted network — `ssl: true` in the Postgres config and `sslmode=require` for the client.
5. **Set per-user resource limits:**
   ```sql
   ALTER USER analytics_readonly SET statement_timeout = '60s';
   ALTER USER analytics_readonly CONNECTION LIMIT 5;
   ALTER USER analytics_readonly SET idle_in_transaction_session_timeout = '30s';
   ```
6. **Use a read replica** if 3rd-party load impacts the ingester (the platform does not ship with one — add as needed).
7. **Sign a Data Sharing Agreement** before granting `v_license_plates_public` access — license plate data is PDPA-protected.

---

## 9. Common Analytics Queries

```sql
-- Camera online/offline status (5-minute heartbeat threshold)
SELECT
  id, name,
  last_seen_at,
  CASE
    WHEN last_seen_at > NOW() - INTERVAL '5 minutes' THEN 'online'
    ELSE 'offline'
  END AS status
FROM cameras
WHERE enabled = TRUE
ORDER BY name;


-- Event count per camera per day (Asia/Bangkok day boundaries)
SELECT
  camera_id,
  DATE(event_time AT TIME ZONE 'Asia/Bangkok') AS event_date,
  COUNT(*) AS event_count
FROM events
WHERE event_time >= NOW() - INTERVAL '7 days'
GROUP BY camera_id, event_date
ORDER BY event_date DESC, event_count DESC;


-- Recent events with snapshots
SELECT
  e.id, e.camera_id, c.name AS camera_name,
  e.event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  e.event_type, e.rule_name, e.object_class, e.snapshot_filename
FROM events e
LEFT JOIN cameras c ON c.id = e.camera_id
WHERE e.has_snapshot = TRUE
ORDER BY e.event_time DESC
LIMIT 20;


-- Alert delivery summary (last 24 hours)
SELECT status, COUNT(*) AS count
FROM alert_logs
WHERE sent_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;
```

> **Note:** The queries above use base table names for clarity. 3rd parties should substitute the view names (e.g. `v_events_public`, `v_cameras_public`) as documented in the companion integration guide.

---

## 10. Schema Migration History

| Migration | Change |
|---|---|
| `init.sql` v1.0 | Core tables: cameras, events, appearances, license_plates, line_config, alert_rules, alert_logs, users, sessions, audit_log, system_settings, event_categories |
| migration_011 | Added `analytics_event_display` to `system_settings` |
| migration_012 | Added `active_from`, `active_to` (quiet hours) to `alert_rules` |
| migration_013 | Added `report_schedules` table |
| migration_014 | Added `image_layout` to `report_schedules` |
| migration_015 | Added `send_days` (weekly days) to `report_schedules` |
| migration_016 | Added license tables |
| migration_017 | Added `auditor` role to `users.role` |
| migration_018 | Added camera offline alert columns |
| migration_019 | Added `escalate_once` config |
| migration_021 | Added `report_history` table |
| migration_022 | Added `health` report type to `report_history` |
| migration_023 | Added pending recipients to `line_config` |
| migration_024 | Added `target_camera_id` to `audit_log` |
| migration_025 | Backfilled and indexed `snapshot_filename` / `has_snapshot` in `events` |
| migration_026 | Added `oa_basic_id` to `line_config` |
| migration_027 | **Third-party views + role** — 11 `v_*_public` views + `third_party_readonly` NOLOGIN role |

---

<sub>End of REF_database-schema_EN.md · Vigil Platform · 2026-06-08</sub>
