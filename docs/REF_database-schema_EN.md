<!-- ============================================================ -->
<!-- Vigil Platform — Database Schema Reference (EN)     -->
<!-- @copyright (c) 2025-2026 Prakasit Rochanavipart             -->
<!-- @license Proprietary                                         -->
<!-- ============================================================ -->

# Database Schema Reference (English)

> **Audience:** External partners, DBAs, and integration engineers who need to understand the database structure of the Vigil Platform.
>
> **Status:** Standalone reference — distribute freely to authorized 3rd parties.
> **Last updated:** 2026-08-11 · Schema baseline: migration 142
> **Companion document:** [REF_third-party-integration_EN.md](REF_third-party-integration_EN.md) — connection setup, query patterns, security checklist.

---

## About This Document

The Vigil Platform is a self-hosted CCTV analytics platform that ingests events from IP cameras (Bosch, Hikvision, Dahua, ONVIF) via MQTT, stores them in PostgreSQL, and provides operational dashboards, scheduled reports, and LINE-based alerts. It supports multi-site deployment, license plate recognition (LPR), face recognition, watchlist integration, and blacklist management.

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
   event_categories        Analytics categories (custom + built-in, per-site)
   event_category_rules    Mapping rule -> category
   system_settings         Key/value settings and white-label branding
   report_schedules        Recurring report delivery configuration
   report_history          Log of every report send

Sites & Multi-tenancy
   sites                   Site definitions (multi-site support)
   user_sites              User-to-site access mapping

LPR & Watchlist
   license_plates          (Extended) LPR data with vehicle attributes
   lpr_watchlist           Watchlist entries (vehicle plates to monitor)
   lpr_watchlist_groups    Grouping of watchlist entries
   lpr_alert_acks          Acknowledgment log for LPR alerts
   lpr_alert_cooldown      Cooldown tracking per plate
   lpr_alert_hourly        Hourly statistics for LPR alerts

Blacklist & Integration
   blacklist.sources       Blacklist data sources (manual, external APIs)
   blacklist.source_records  Individual records from blacklist sources
   blacklist.master        Deduplicated master blacklist
   blacklist.master_links  Links between master entries and source records
   blacklist.overrides     Local corrections/overrides for blacklist
   blacklist.bridge_rules  Rules that bridge blacklist to lpr_watchlist

Edge & Monitoring
   edge_status             Status of edge nodes (EDGE_MODE deployment)
   metrics_host            Time-series CPU/RAM/disk/network per host

Face Recognition (if enabled)
   face_embeddings         Vector embeddings for face recognition
   face_blacklist          Enrolled blacklist entries with embeddings
   face_blacklist_groups   Grouping of face blacklist entries
   face_blacklist_hits     Log of blacklist matches
   face_embed_queue        Processing queue for face embedding

Traffic & Enforcement
   traffic_hourly_stats    Pre-aggregated LPR statistics (vehicle type, seatbelt, helmet counts)

Rollups (read instead of `events` / `license_plates` on hot paths)
   event_dim_bucket        Event counts per 30 min by category-rule dimensions -> 3.44
   lpr_dim_daily           LPR chart totals per day x camera x dimension      -> 3.45
   lpr_hourly_stats        Per-camera hourly LPR counts (migration 171)

Storage & Files
   public_files            Admin-uploaded files for customers (File Service)   -> 3.42
   storage_stats           Per-machine, per-category storage measurements      -> 3.43

API & Integration
   api_consumers           Partner API consumer credentials
   api_request_log         Audit log of Partner API calls

Misc
   hcp_camera_map          Mapping of HCP (vendor system) camera indexes to platform camera IDs
   camera_httphost_backups  Backup log of camera HTTP host rewrites (ANPR repointing)
```

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
| `mqtt_topic_prefix` | VARCHAR(150) | e.g. `BoschCam1/` |
| `model` | VARCHAR(100) | e.g. `FlexiDome 8100i` — can be auto-detected via migration 091 |
| `firmware` | VARCHAR(50) | |
| `serial_number` | VARCHAR(100) | |
| `latitude` | DOUBLE PRECISION | GPS coordinate |
| `longitude` | DOUBLE PRECISION | GPS coordinate |
| `location_label` | VARCHAR(255) | Human-readable location |
| `group_id` | INT FK -> `camera_groups` | |
| `enabled` | BOOLEAN | |
| `paused` | BOOLEAN | Maintenance mode flag (migration 037) |
| `last_seen_at` | TIMESTAMPTZ | Last MQTT heartbeat |
| `last_event_at` | TIMESTAMPTZ | Last received event |
| `enable_snapshot` | BOOLEAN | Whether to fetch snapshot on alarm |
| `enable_vca_overlay` | BOOLEAN | Snapshot with IVA bounding box overlay |
| `enable_clip_capture` | BOOLEAN | 24/7 RTSP buffer + dump on alarm |
| `clip_pre_sec` | INT | Pre-alarm window (1..60) |
| `clip_post_sec` | INT | Post-alarm window (0..30) |
| `sort_order` | INT | Manual ordering for Camera Status grid (migration 077) |
| `nvr_channel` | INT | NVR channel number for multi-channel devices (migration 083) |
| `capture_categories` | TEXT[] | Event categories to capture (migration 083) |
| `device_id` | VARCHAR(100) | Physical device identifier (migration 083) |
| `recording_nvr_id` | VARCHAR(100) | Maps standalone LPR cameras to their recording NVR (migration 087) |
| `model_detected_at` | TIMESTAMPTZ | Timestamp of auto-detected model (migration 091) |
| `model_detect_error` | TEXT | Error message if detection failed (migration 091) |
| `sd_detail_json` | JSONB | MicroSD card details in vendor-specific format (migration 115) |
| `max_hold_sec` | INT | Maximum buffer hold time (migration 116) |
| `max_hold_at` | TIMESTAMPTZ | When the hold reached max (migration 116) |
| `site_id` | VARCHAR(50) FK -> `sites` | Multi-site assignment (migration 043) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Indexes:** `group_id`, `enabled`, `last_seen_at DESC`, `site_id`

---

### 3.3 `events`
**The main table.** Every IVA event received from any camera via the MQTT ingester.

> 🔀 **Partitioned since 2026-07-22** (`195d743`, CEN-003). The conversion lives in
> `db/MANUAL_partition_events_option_a.sql` — a **manual** migration, not one `migrate.js` runs,
> because it takes a real table lock (measured window ~90.7 s on production).
>
> - `PARTITION BY RANGE (event_time)`, **monthly** partitions named `events_yYYYYmMM`
>   (`PART_RE`, `src/helpers/partitionRetention.js:45`), plus `events_default` as the catch-all
> - **The primary key is now `(id, event_time)`** — Postgres requires the partition key to be part
>   of it. A bare `WHERE id = $1` scans every partition; always bound `event_time` too.
> - The manual script creates **2026-01 through 2027-12 (24 partitions) + `events_default`**.
>   Later months must be added by hand per Step 7 in that file — **nothing creates them ahead of
>   time.**
> - Old data is removed by `enforcePartitionRetention()`: `DROP TABLE` on a whole partition
>   (instant) instead of a `DELETE` that leaves millions of dead tuples behind. It is **opt-in via
>   `system_settings.partition_drop_enabled = 'true'`**, and a partition is only dropped once the
>   **longer** of `data_retention_days` and `lpr_retention_days` has passed — one partition holds
>   rows governed by both.
> - Converting dropped the children's `ON DELETE CASCADE`, so all 5 FK children (`appearances`,
>   `license_plates`, `face_event_notes`, `face_event_acks`, `lpr_alert_acks`) must be cleaned
>   explicitly before a partition is dropped (`195d743`).
> - Visible consequence: a whole-table `count(*)` became a 40 s full scan, so
>   `/api/health/details` switched to `SUM(reltuples)` per partition (decision #263).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT | Part of the composite PK `(id, event_time)`; still sequence-generated |
| `camera_id` | VARCHAR(100) | **No FK** — events can arrive before the camera is registered |
| `event_time` | TIMESTAMPTZ NOT NULL | Camera-side timestamp (UTC) |
| `received_at` | TIMESTAMPTZ | Subscriber receive time (UTC) |
| `event_type` | VARCHAR(50) | e.g. `Crossing line 1`, `Object In Field`, `Loitering` |
| `event_category` | VARCHAR(50) | `RuleEngine` / `VideoSource` / `Device` / `Behavior` |
| `event_state` | VARCHAR(20) | `active` / `inactive` / `single` |
| `rule_name` | VARCHAR(150) | Name of the IVA rule that triggered |
| `object_id` | VARCHAR(50) | Tracked object ID |
| `object_class` | VARCHAR(30) | `Person` / `Vehicle` / `Bicycle` / `Animal` / `Pickup` (migration 081 splits Pickup from Truck) |
| `likelihood` | REAL | Confidence score 0.0–1.0 |
| `snapshot_filename` | VARCHAR(255) | Relative path to saved image |
| `has_snapshot` | BOOLEAN | |
| `clip_file` | TEXT | Video clip filename |
| `clip_status` | VARCHAR(16) | `pending` / `done` / `failed` |
| `clip_duration_sec` | REAL | Actual capture duration |
| `vehicle_type` | VARCHAR(30) | Denormalized from license_plates for performance (migration 089) |
| `raw_json` | JSONB | **INTERNAL** — raw MQTT payload (excluded from 3rd-party views) |

**Indexes:** `camera_id`, `event_time DESC`, `event_type`, `rule_name`, `object_class`, `(camera_id, event_time DESC)`, `(event_time DESC, id DESC)` (keyset pagination, migration 071), partial indexes filtered on `has_snapshot`, GIN on `raw_json`, expression index for Dahua FaceDetector/Comparison (migration 103),
`idx_events_class_time (object_class, event_time DESC) INCLUDE (event_type, event_state, has_snapshot, camera_id)` (Events object_class filter, migration 184),
**`idx_events_anpr_noread_time (event_time DESC, id DESC) WHERE event_type = 'anprAlarm' AND COALESCE(raw_json->>'plate','') = ''`** (migration 199 — backs the LPR "no plate read" tab; the predicate text must stay byte-identical to the route's, or the planner silently stops using it)

> ⚠️ These are **partitioned indexes** now. `CREATE INDEX CONCURRENTLY` on the parent is
> impossible in Postgres 16, so on production a new index is built with
> `scripts/create-face-blacklist-index.js --index=<name>` (child by child → parent template
> `ON ONLY` → `ATTACH`). **Done means `pg_index.indisvalid = true`**, not "all children built" —
> the template stays invalid until every child is attached, and the planner ignores an invalid
> index.

> **Data volume:** At 100 cameras, expect 5M–50M rows/year depending on event frequency.
> Default retention: **365 days** (configurable via `system_settings.data_retention_days`, except anprAlarm which uses `lpr_retention_days` per decision #213)

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
| `hair_length` | VARCHAR(20) | IVA Pro attribute (migration 031) |
| `top_category` | VARCHAR(30) | IVA Pro category (migration 031) |
| `bottom_category` | VARCHAR(30) | IVA Pro category (migration 031) |
| `glasses` | BOOLEAN | Wearing glasses (migration 031) |
| `helmet_wear` | BOOLEAN | Helmet wearing (migration 031) |
| `hair_color` | VARCHAR(30) | Human-readable hair color (migration 033) |
| `confidence` | REAL | |
| `attributes` | JSONB | Additional attributes |
| `detected_at` | TIMESTAMPTZ | |

**Indexes:** `event_id`, `(detected_at, id)` cursor paging index (migration 121)

---

### 3.5 `license_plates`
License plate recognition (LPR) data with extended vehicle attributes.

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
| `vehicle_type` | VARCHAR(30) | Car / truck / motorcycle (migration 036, backfilled 089) |
| `vehicle_color` | VARCHAR(30) | Vehicle color (migration 036) |
| `vehicle_brand` | VARCHAR(50) | Vehicle brand/model identifier; for Hikvision = numeric code (migration 036) |
| `plate_image` | VARCHAR | Relative path to cropped license plate image (migration 036) |
| `no_seatbelt` | BOOLEAN | Driver/passenger no seatbelt (migration 073, decision #214) |
| `plate_type` | VARCHAR(20) | Thai plate category (commercial, personal, etc.) based on color (migration 084) |
| `plate_color` | VARCHAR(20) | Physical color of the plate (migration 085) |
| `no_helmet` | BOOLEAN | Rider has no helmet (migration 085) |
| `rider_count` | SMALLINT | Number of riders (migration 090, for motorcycle seatbelt checking) |
| `plate_char_believe` | REAL | Confidence per character (migration 108) |
| `license_bright` | REAL | Brightness metric (migration 108) |

**Indexes:** `event_id`, `camera_id`, `detected_at DESC`, `UPPER(plate_number)` functional index (migration 104), trigram GIN on `plate_number` (migration 086), partial index `idx_plates_no_seatbelt WHERE no_seatbelt` (migration 073), partial index for riders >= 3 (migration 090)

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
| `oa_basic_id` | TEXT | LINE Official Account `@basicId` (migration 026) |
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
| `active_from` | TIME | Start of active window (null = 24/7) (migration 012) |
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
| `role` | VARCHAR(20) | `admin` / `viewer` / `auditor` (migration 017 added auditor) |
| `enabled` | BOOLEAN | |
| `must_change_password` | BOOLEAN | Forces password reset on next login |
| `last_login_at` | TIMESTAMPTZ | |
| `last_login_ip` | VARCHAR(45) | **PII** — login IP address |
| `failed_attempts` | INT | Consecutive failed login count |
| `locked_until` | TIMESTAMPTZ | Account lockout timestamp |
| `created_at` / `updated_at` | TIMESTAMPTZ | |
| `created_by` | INT FK -> `users` | |

**Triggers:** `AFTER UPDATE` trigger on `password_hash` (migration 140) — logs all password changes to `audit_log`, never fails if trigger errors (exception handler)

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
| `target_camera_id` | TEXT | If action affects a camera (migration 024) |
| `ip_address` | VARCHAR(45) | **PII** |
| `user_agent` | TEXT | |
| `details` | JSONB | Action-specific details |
| `created_at` | TIMESTAMPTZ | |

**Retention:** Automatically purged after **90 days**.

> **NEVER expose this table to 3rd parties** — contains PII (IP addresses, user actions).

---

### 3.12 `sites`
Multi-site support (migration 044).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `code` | VARCHAR(50) UNIQUE | Site identifier (e.g. "hkt", "hdy", "main") |
| `name` | VARCHAR(150) | Display name |
| `description` | TEXT | |
| `location` | VARCHAR(255) | Physical location |
| `retention_events_days` | INT | Per-site event retention override (migration 109) |
| `retention_lpr_days` | INT | Per-site LPR data retention (migration 109) |
| `retention_face_days` | INT | Per-site face data retention (migration 109) |
| `retention_min_free_gb` | INT | Minimum free disk before auto-pruning (migration 109) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.13 `event_categories`
Analytics categories (custom + built-in, locked).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(100) | Unique within site (migration 075) |
| `icon` | VARCHAR(20) | Icon identifier |
| `color` | VARCHAR(20) | Hex color |
| `kind` | VARCHAR(20) | `event` / `people_counter` / `vehicle_counter` |
| `is_locked` | BOOLEAN | True = cannot be renamed/deleted (migration 076, replaces `is_builtin`) |
| `sort_order` | INT | |
| `site_id` | VARCHAR(50) FK -> `sites` | Multi-site scoping (migration 075) |

**Built-in rows:** `People Counting` (id=1), `Vehicle Counting` (id=2).

**Constraints:** `UNIQUE(site_id, name)`

---

### 3.14 `event_category_rules`
Mapping rules (event → category), used by the stats engine.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `category_id` | INT FK -> `event_categories` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(80) | NULL = all cameras |
| `rule_name` | VARCHAR(200) | NULL = all rules |
| `event_type` | VARCHAR(80) | NULL = all types |
| `object_class` | VARCHAR(40) | NULL = all classes |
| `vehicle_type` | VARCHAR(40) | NULL = all types; for LPR category matching (migration 088) |
| `match_state` | VARCHAR(10) | Default `true` |
| `priority` | INT | |

---

### 3.15 `user_sites`
User-to-site access mapping (migration 044).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `user_id` | INT FK -> `users` ON DELETE CASCADE | |
| `site_id` | VARCHAR(50) FK -> `sites` ON DELETE CASCADE | |
| `role` | VARCHAR(20) | User role at this site (subset of global role) |

---

### 3.16 `system_settings`
Key/value store for platform settings and white-label branding.

| Key | Default | Description |
|---|---|---|
| `data_retention_days` | `365` | Days of general events to keep (max 730) — except anprAlarm (decision #213) |
| `snapshot_retention_days` | `30` | Days of snapshot images to keep on central disk (max 365) (migration 125) |
| `lpr_retention_days` | `30` | Days to keep LPR rows and associated data (max 730); sole authority on LPR (migration 047, decision #213) |
| `lpr_image_retention_days` | `7` | Days to keep LPR image files (≤ lpr_retention_days) |
| `rawxml_retention_days` | `90` | Strip `raw_json.rawXml` older than this for class-D storage (migration 074, decision #212) |
| `clip_retention_days` | `30` | Days to keep video clip files |
| `appearances_retention_days` | `40` | Days to keep appearance/biometric rows |
| `display_timezone` | `Asia/Bangkok` | Timezone for date boundaries |
| `counter_dedup_mode` | `state` | `state` / `object_window` / `none` |
| `comparison_mode` | `rolling` | `rolling` / `calendar` |
| `custom_range_max_days` | `365` | Max span for custom date range picker |
| `analytics_event_display` | CSV of types | Event types shown in live feed (migration 011) |
| `api_log_retention_days` | `90` | Partner API request log retention (migration 122) |
| `brand_name` | `Vigil Platform` | Product name (white-label) |
| `brand_tagline` | `CCTV Analytics Suite` | Subtitle |
| `brand_logo_path` | `` (empty) | Logo file path |
| `brand_primary_color` | `#5b8def` | Primary accent color |
| `mapbox_token` | `` (empty) | Mapbox API token for Map page (migration 029, decision #171) |
| `lpr_line_image_expire_hours` | `24` | ImgBB image expiry for LPR alerts (migration 114) |
| `nav_hidden_pages` | `["media"]` | JSON array of nav pages to hide — a **hide**-list, not a show-list (migration 141, decision #239) |
| `signed_image_expire_hours` | (not seeded) | TTL for self-signed image links, clamped to **1–720 h** (migration 147) — see `docs/LOGIC_line-notifications.md` |
| `report_retention_days` | — | How long generated report PNGs are kept (migration 177) |
| `lpr_noread_check` | (written by job) | Weekly self-check of the "no plate read" definition (migration 199): JSON `{checked_at, hours, predicate, anti_join, mismatch, ok}`. Written by `src/helpers/noreadCheck.js` (Sun 04:30 ICT); surfaced at `/api/health/details` → `lpr.noread_check` |
| `traffic_stats_reconciled_day` | (written by job) | Local (Bangkok) date on which the traffic/LPR hourly-stats reconcile last ran — stops an api-server restart during the reconcile hour from redoing the heaviest job of the day (decision #267, `src/traffic-stats-refresher.js:57`) |
| `partition_drop_enabled` | `false` | Must be `'true'` before an `events` partition is actually dropped — see §3.3 |

Schema: `key VARCHAR(80) PK`, `value TEXT`, `description TEXT`, `updated_at TIMESTAMPTZ`

> Keys marked *(written by job)* are not seeded by a migration. The row appears only after the
> background job first runs — a missing row is not a misconfiguration.

---

### 3.17 `report_schedules`
Recurring report delivery configuration.

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `report_type` | VARCHAR(16) | `daily` / `weekly` / `monthly` |
| `enabled` | BOOLEAN | |
| `send_time` | TIME | Time of day to fire (in `display_timezone`) |
| `recipients` | TEXT | CSV of email addresses (**PII**) |
| `image_layout` | VARCHAR(12) | Layout used (migration 014) |
| `last_run_at` | TIMESTAMPTZ | Prevents same-day double-fire |
| `last_status` | VARCHAR(24) | `success` / `failed` / `pending` / null |
| `last_error` | TEXT | |

---

### 3.18 `report_history`
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

### 3.19 `edge_status`
Status and metrics of edge nodes in EDGE_MODE deployment (migration 067).

| Column | Type | Notes |
|---|---|---|
| `site_id` | VARCHAR(50) PK FK -> `sites` | Edge site identifier |
| `last_seen_at` | TIMESTAMPTZ | Last heartbeat timestamp |
| `disk_free_gb` | REAL | Free disk space |
| `disk_total_gb` | REAL | Total disk capacity |
| `bridge_forwarded` | INT | MQTT messages forwarded from edge to central |
| `bridge_dropped` | INT | MQTT messages dropped due to queue full |
| `bridge_remote` | INT | Messages from remote (non-local) |
| `bridge_local` | INT | Messages from local (LAN) |
| `pm2_json` | JSONB | PM2 process list snapshot |
| `snapshot_oldest` | DATE | Date of oldest snapshot file (migration 072) |
| `snapshot_dirs` | INT | Number of snapshot directories (migration 072) |
| `storage_json` | JSONB | mdraid + mount point status (migration 100) |
| `last_svc_result` | TEXT | Result of restart/stop command sent via MQTT (migration 098) |
| `retention_json` | JSONB | Per-site retention policy feedback (migration 110) |
| `last_prune_json` | JSONB | Last pruning operation results (migration 110) |
| `inventory_json` | JSONB | Snapshot inventory per folder (migration 111) |

---

### 3.20 `lpr_watchlist`
Watchlist entries (vehicle plates to monitor for LINE alerts).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `group_id` | INT FK -> `lpr_watchlist_groups` ON DELETE CASCADE | (migration 112) |
| `plate_number` | VARCHAR(20) | License plate to match |
| `plate_country` | VARCHAR(10) | ISO-2 country code |
| `notify_line` | BOOLEAN | Send LINE alert when matched (migration 113) |
| `description` | TEXT | Reason for watchlist entry |
| `enabled` | BOOLEAN | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.21 `lpr_watchlist_groups`
Grouping and alert configuration for watchlist entries (migration 112).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | Group name |
| `description` | TEXT | |
| `default_alert_mode` | VARCHAR(20) | Alert behavior for this group (migration 099, decision #231) |
| `enabled` | BOOLEAN | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.22 `lpr_alert_acks`
Acknowledgment log for LPR alerts (migration 112).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `plate_id` | BIGINT FK -> `license_plates` | |
| `user_id` | INT FK -> `users` | User who acknowledged |
| `message` | TEXT | Optional note |
| `acked_at` | TIMESTAMPTZ | Acknowledgment timestamp |

---

### 3.23 `lpr_alert_cooldown`
Cooldown tracking per plate to prevent alert flooding (migration 112).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `plate_number` | VARCHAR(20) | License plate |
| `group_id` | INT FK -> `lpr_watchlist_groups` | |
| `last_alert_at` | TIMESTAMPTZ | Last time alert was sent |
| `cooldown_until` | TIMESTAMPTZ | Do not re-alert until this time |

---

### 3.24 `lpr_alert_hourly`
Hourly statistics for LPR alerts (migration 112).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `hour_bucket` | TIMESTAMPTZ | Hour (truncated to hour boundary) |
| `group_id` | INT FK -> `lpr_watchlist_groups` | |
| `alert_count` | INT | Number of alerts in this hour |
| `unique_plates` | INT | Unique plate numbers matched |

---

### 3.25 `blacklist.sources`
Blacklist data sources (manual, external APIs, etc.) (migration 093).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | Source name |
| `description` | TEXT | |
| `source_type` | VARCHAR(50) | `manual` / `external_api` / `import` / etc. (migration 124 adds "manual") |
| `pull_interval_hours` | INT | Auto-sync interval (migration 107) |
| `push_types` | TEXT[] | What data to push back (migration 107) |
| `push_mode` | VARCHAR(20) | `auto` / `manual` (migration 107) |
| `push_auto_enabled` | BOOLEAN | Enable automatic push (migration 107) |
| `kept_types` | TEXT[] | Data types to retain even if deprecated (migration 106) |
| `last_sync_at` | TIMESTAMPTZ | |
| `sync_status` | VARCHAR(20) | `success` / `failed` / `pending` |
| `error_message` | TEXT | |
| `enabled` | BOOLEAN | |

---

### 3.26 `blacklist.source_records`
Individual records from blacklist sources (migration 093).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `source_id` | INT FK -> `blacklist.sources` ON DELETE CASCADE | |
| `plate_number` | VARCHAR(20) | License plate |
| `case_ref` | VARCHAR(100) | Reference (case #, incident #, etc.) |
| `display_name` | TEXT | Human-readable name/vehicle description |
| `plate_encrypted` | BYTEA | Encrypted plate number (PDPA compliance) |
| `record_data` | JSONB | Raw record from source |
| `data_hash` | VARCHAR(64) | Dedup key to track vanished records (migration 128) |
| `seen_at` | TIMESTAMPTZ | Last seen in source |
| `vanished_at` | TIMESTAMPTZ | Marked vanished from source (migration 128) |

---

### 3.27 `blacklist.master`
Deduplicated master blacklist (migration 093).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `plate_number` | VARCHAR(20) | Canonical plate |
| `country` | VARCHAR(10) | ISO-2 country |
| `plate_type` | VARCHAR(50) | License type/category |
| `description` | TEXT | Reason/notes |
| `risk_level` | VARCHAR(20) | `critical` / `high` / `medium` / `low` |
| `enabled` | BOOLEAN | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.28 `blacklist.master_links`
Links between master entries and source records (migration 093).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `master_id` | BIGINT FK -> `blacklist.master` ON DELETE CASCADE | |
| `source_record_id` | BIGINT FK -> `blacklist.source_records` ON DELETE CASCADE | |
| `link_type` | VARCHAR(20) | `primary` / `alias` / `related` |

---

### 3.29 `blacklist.overrides`
Local corrections/overrides for blacklist (migration 094).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `master_id` | BIGINT FK -> `blacklist.master` ON DELETE CASCADE | |
| `plate_dedup_key` | VARCHAR(100) | Dedup identifier (migration 094) |
| `corrected_value` | TEXT | Corrected data |
| `override_reason` | TEXT | Why this override exists |
| `user_id` | INT FK -> `users` | Who made the override |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.30 `blacklist.bridge_rules`
Rules that bridge blacklist entries to lpr_watchlist (migration 096).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | Rule name |
| `source_id` | INT FK -> `blacklist.sources` | Source to pull from |
| `target_group_id` | INT FK -> `lpr_watchlist_groups` | Watchlist group to populate |
| `match_criteria` | JSONB | Matching criteria (plate pattern, risk level, etc.) |
| `auto_create_entries` | BOOLEAN | Automatically create watchlist entries on source update |
| `enabled` | BOOLEAN | |

---

### 3.31 `metrics_host`
Time-series CPU/RAM/disk/network per host (migration 097).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `host_name` | VARCHAR(100) | Hostname (central, hkt, hdy, vss, etc.) |
| `bucket_time` | TIMESTAMPTZ | 1-minute bucket |
| `cpu_percent` | REAL | CPU usage % |
| `memory_percent` | REAL | RAM usage % |
| `disk_percent` | REAL | Disk usage % |
| `network_rx_mbps` | REAL | Receive throughput |
| `network_tx_mbps` | REAL | Transmit throughput |
| `tunnel_up` | BOOLEAN | Cloudflare Tunnel status (migration 101) |
| `tailscale_up` | BOOLEAN | Tailscale VPN status (migration 101) |

> **Data volume:** ~1.58M rows/year per host at 1-minute intervals.

---

### 3.32 `face_embeddings`
Vector embeddings for face recognition (migration 129).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK -> `events` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(100) | Denormalized for query speed (migration 131) |
| `face_vector` | vector(512) | AuraFace-v1 embedding (pgvector) |
| `model_version` | VARCHAR(50) | Model used for embedding |
| `confidence` | REAL | Detection confidence |
| `created_at` | TIMESTAMPTZ | |

**Indexes:** `event_id`, `(camera_id, created_at)` (migration 131)

---

### 3.33 `face_blacklist`
Enrolled blacklist entries with embeddings for face recognition (migration 129).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `group_id` | INT FK -> `face_blacklist_groups` ON DELETE CASCADE | (migration 137) |
| `display_name` | VARCHAR(150) | Name or case reference |
| `face_vector` | vector(512) | Enrolled face embedding |
| `model_version` | VARCHAR(50) | Model used |
| `enrolled_ref` | TEXT | Reference to enrollment batch (migration 133) |
| `enabled` | BOOLEAN | |
| `notify_line` | BOOLEAN | Send alert on match (migration 137) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.34 `face_blacklist_groups`
Grouping of face blacklist entries (migration 137).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | Group name |
| `description` | TEXT | |
| `enabled` | BOOLEAN | |

---

### 3.35 `face_blacklist_hits`
Log of blacklist matches by face recognition (migration 134).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK -> `events` ON DELETE CASCADE | |
| `blacklist_id` | INT FK -> `face_blacklist` | |
| `similarity_score` | REAL | Match similarity (0–1) |
| `matched_at` | TIMESTAMPTZ | |

---

### 3.36 `face_embed_queue`
Processing queue for face embedding (migration 129).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `event_id` | BIGINT FK -> `events` ON DELETE CASCADE | |
| `camera_id` | VARCHAR(100) | Denormalized (migration 131) |
| `time_bucket` | TIMESTAMPTZ | For grouping + dedup (migration 138) |
| `status` | VARCHAR(20) | `pending` / `processing` / `done` / `failed` |
| `error_message` | TEXT | |
| `processed_at` | TIMESTAMPTZ | |

**Indexes:** `(camera_id, time_bucket)` (migration 138), `UNIQUE(time_bucket)` (migration 139)

---

### 3.37 `traffic_hourly_stats`
Pre-aggregated LPR statistics for Traffic Enforcement page (migration 142).

| Column | Type | Notes |
|---|---|---|
| `camera_id` | VARCHAR(100) | Camera ID |
| `bucket_hour` | TIMESTAMPTZ | Hour boundary (truncated) |
| `vehicle_type` | VARCHAR(30) | Vehicle category (car, truck, motorcycle, pickup) |
| `n_total` | INT | Total vehicles detected |
| `n_no_helmet` | INT | Riders without helmet |
| `n_no_seatbelt` | INT | Drivers/passengers without seatbelt |
| `n_riders3` | INT | Motorcycles with 3+ riders |

**Primary Key:** `(camera_id, bucket_hour, vehicle_type)`

---

### 3.38 `api_consumers`
Partner API consumer credentials (migration 119).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(150) | Partner name |
| `api_key` | VARCHAR(128) | Generated API key |
| `secret_hash` | TEXT | Hashed secret (bcrypt) |
| `max_lookback_days` | INT | Maximum historical lookback allowed (migration 120) |
| `site_codes` | TEXT[] | Allowed sites (migration 120) |
| `enabled` | BOOLEAN | |
| `expires_at` | TIMESTAMPTZ | Credential expiry (migration 123, decision #234) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

### 3.39 `api_request_log`
Audit log of Partner API calls (migration 119).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `consumer_id` | INT FK -> `api_consumers` | |
| `endpoint` | VARCHAR(255) | Called endpoint |
| `method` | VARCHAR(10) | HTTP method |
| `status_code` | INT | Response code |
| `response_time_ms` | INT | |
| `requested_at` | TIMESTAMPTZ | |

**Retention:** Automatically purged after `system_settings.api_log_retention_days` (default 90 days).

---

### 3.40 `hcp_camera_map`
Mapping of HCP (vendor system) camera indexes to platform camera IDs (migration 126).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `hcp_camera_index_code` | VARCHAR(100) | HCP system camera identifier |
| `camera_id` | VARCHAR(100) FK -> `cameras` | Platform camera ID |
| `mapping_status` | VARCHAR(20) | `active` / `inactive` |

---

### 3.41 `camera_httphost_backups`
Append-only log of camera HTTP host rewrites (migration 102).

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `camera_id` | VARCHAR(100) | |
| `old_ip_address` | VARCHAR(45) | Previous IP address |
| `new_ip_address` | VARCHAR(45) | New IP address after repoint |
| `old_http_port` | INT | Previous port |
| `new_http_port` | INT | New port |
| `repointed_at` | TIMESTAMPTZ | When the change was made |
| `repointed_by` | INT FK -> `users` | User who performed the repoint |
| `reason` | TEXT | Reason for repointing (ANPR repoint, etc.) |

---

### 3.42 `public_files`

Files an admin uploads to hand to a customer (File Service) — migration 179. The bytes live under
`files/`; the on-disk name is a system-generated UUID. `original_name` is used only for display
and for the download filename — **it never takes part in building a path.**

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `serial` | NO | PK |
| `stored_name` | `text` | NO | **UNIQUE** · `<uuid>.<ext>` generated by the server — the key `/pub/fil/` looks up |
| `original_name` | `text` | NO | Name as uploaded (stored UTF-8, after decoding busboy's latin-1) |
| `mime` | `text` | NO | Decided from **magic bytes**, never from the client |
| `bytes` | `bigint` | NO | File size |
| `sha256` | `text` | NO | Content hash |
| `uploaded_by` | `text` | YES | Username of the admin who uploaded |
| `uploaded_at` | `timestamptz` | NO | default `now()` |
| `expires_at` | `timestamptz` | YES | Once past, `/pub/fil/` answers `410` and the daily sweep deletes the file from disk |
| `revoked_at` | `timestamptz` | YES | Set on manual revoke **or** when the sweep deletes the bytes — the row is kept for audit |
| `note` | `text` | YES | Free-text admin note |

**Indexes:** `idx_public_files_uploaded_at (uploaded_at DESC)`, plus partial
`idx_public_files_revoked_at` and `idx_public_files_expires_at` (`WHERE … IS NOT NULL`)

> `revoked_at IS NOT NULL` with no file on disk is the **normal** end state, not data corruption:
> revoking deletes the bytes and deliberately keeps the row.

---

### 3.43 `storage_stats`

Per-machine, per-category storage measurements behind Health → Storage — migrations 176/178.
**These are values from a scan, not live figures** — always read them next to `measured_at`.

| Column | Type | Null | Notes |
|---|---|---|---|
| `machine` | `text` | NO | `central`, or an edge site code · part of the PK with `category` |
| `category` | `text` | NO | `events` · `lpr` · `lpr-watchlist` · `face-blacklist` · `blacklist-photos` · `reports` · `public-files` · `root-flat` |
| `bytes` | `bigint` | NO | Sum of apparent file sizes |
| `bytes_disk` | `bigint` | NO | **Space actually allocated** (`st.blocks * 512`) — the number to make decisions on; can exceed `bytes` by >2× when many files are small |
| `files` | `bigint` | NO | File count |
| `oldest_at` | `timestamptz` | YES | mtime of the oldest file |
| `partial` | `boolean` | NO | `true` = the scan ran out of its time budget, so the figures are **under**-counts |
| `disk_total` / `disk_used` | `bigint` | YES | For the whole disk the directory sits on |
| `scan_ms` | `integer` | YES | How long that scan took |
| `measured_at` | `timestamptz` | NO | default `now()` |
| `orphans` / `orphans_bytes_disk` / `orphans_at` | `bigint` / `bigint` / `timestamptz` | YES | Files with no `events` row referencing them — **displayed only, deletion is not offered**: ~2.5 % of events never recorded a `snapshot_filename`, so their images look ownerless while still being evidence |

---

### 3.44 `event_dim_bucket` (rollup)

Event counts per **30-minute bucket**, keyed by the dimensions the category rules decide on —
migration **163** (2026-08-19).

| Column | Type | Null | Notes |
|---|---|---|---|
| `bucket` | `timestamptz` | NO | `date_bin('30 minutes', event_time, '2000-01-01')` |
| `camera_id` | `varchar(80)` | NO | |
| `rule_name` / `event_type` / `object_class` / `vehicle_type` / `event_state` | `varchar` | NO | **`NOT NULL DEFAULT ''`**, never `NULL` — readers must `NULLIF(x,'')` to get the original shape back |
| `n` | `integer` | NO | Events in that bucket |
| `updated_at` | `timestamptz` | NO | |

**PK:** `(bucket, camera_id, rule_name, event_type, object_class, vehicle_type, event_state)`

- **Writer:** `src/category-rollup-refresher.js` — every **5 min** (`CAT_ROLLUP_REFRESH_MS`),
  upserting a **3-hour** look-back window (`CAT_ROLLUP_LOOKBACK_HOURS`), then pruning by
  `RETENTION_DAYS`
- **Readers:** `/api/health/details` (`events.face_total`/`lpr_total`, `image_quality`),
  `/api/cameras/image-quality-log` (`X-Total-Count`), `/api/categories/rule-discovery`, stats page
- ⚠️ **Lags real rows by ≤ ~5 min**, and can stay **permanently** slightly low: the upsert writes
  `n = EXCLUDED.n` only inside that 3-hour window, so an event arriving later is never counted
  into its bucket (observed: bucket 2026-08-24 07:30 on BSH-HDY-4031, dim 2 vs events 4)

---

### 3.45 `lpr_dim_daily` (rollup)

**Per day × camera × dimension** totals behind the LPR page's province / vehicle-type / plate-colour
/ brand charts — migration **171** (2026-08-23). Stored long-format (one row per value of one
dimension), ~15,000 rows/day; a cross-product layout would have been 1.27 M rows/month.

| Column | Type | Null | Notes |
|---|---|---|---|
| `day` | `date` | NO | |
| `camera_id` | `varchar(100)` | NO | |
| `dim` | `text` | NO | `region` · `vehicle_type` · `plate_color` · `vehicle_brand` |
| `value` | `text` | NO | The value of that dimension |
| `n` | `integer` | NO | |
| `updated_at` | `timestamptz` | NO | |

**PK:** `(day, camera_id, dim, value)` · **Index:** `idx_lpr_dim_daily_day (day, dim)`

- **Writer:** `src/traffic-stats-refresher.js:187-197` — every **15 min**
  (`TRAFFIC_STATS_REFRESH_MS`) over a 3-hour look-back, **delete-then-insert per touched day**
  rather than a per-row upsert. A 168-hour reconcile runs once a day at **05:00 Bangkok time**
  (decision #267 — the old 03:00 slot collided with `pg_dump`, which finishes around 04:05) and
  records the date in `system_settings.traffic_stats_reconciled_day`.
- **Readers:** `GET /api/lpr/brands` (`dim = 'vehicle_brand'`, with a further 30-minute in-process
  cache), LPR page charts
- The same migration also creates `lpr_hourly_stats` (PK `(camera_id, bucket_hour)`)

---

## 4. Stored Functions & Triggers

| Name | Type | Description |
|---|---|---|
| `trigger_set_updated_at()` | FUNCTION | Auto-updates `updated_at` before UPDATE |
| `cleanup_old_data()` | FUNCTION | Purges expired sessions, audit_log > 90 days, alert_logs > 90 days. Called hourly by the application. |
| `trg_*_updated` | TRIGGER | Applies `trigger_set_updated_at()` to tables with an `updated_at` column |
| `trg_users_password_hash_audit` | TRIGGER | Logs password changes to audit_log (migration 140) |

---

## 5. PostgreSQL Users & Roles

| Name | Type | Used by | Notes |
|---|---|---|---|
| `vigil_sql` | Login user / DB owner | Platform internals (API server, MQTT ingester, migration runner) | Created by the deployment — **not for 3rd-party use** |
| `third_party_readonly` | **Role** (NOLOGIN) | Granted to 3rd-party login users | Created by migration 027 — has `SELECT` on `v_*_public` views only (migration 118 restored missing grants) |
| `<partner>_ro` | Login user | 3rd party (BI tool, partner dashboard) | Created by the operator per partner; granted `third_party_readonly`. See companion integration guide. |

### Default Application User

| Username | Role | Created by | Notes |
|---|---|---|---|
| `admin` | `admin` | Application on first startup (if `users` table is empty) | Default password `changeme`, `must_change_password = true` — the operator changes this immediately. |

Application roles (inside the `users` table, NOT PostgreSQL roles):
- `admin` — full access
- `viewer` — read-only UI
- `auditor` — view-all + settings, no write (migration 017)

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
| `cameras` | PARTIAL | **Must exclude** credentials — use view `v_cameras_public` |
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
| `blacklist.*` | **CONDITIONAL** | Highly sensitive — PII encrypted — requires written approval |
| `face_*` | **CONDITIONAL** | Biometric data — PDPA-protected — requires explicit consent |

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
- `license_plates` grows at ~370k rows/day (as of August 2026) and has LPR-specific retention.
- Default retention: general events = 365 days, LPR = 30 days, snapshots = 30 days.

### 7.4 Idempotent Migrations
- Migration files (`db_migration_*.sql`) are idempotent and safe to re-run.
- The platform's migration runner applies pending migrations on startup, tracked in `schema_migrations`.

### 7.5 Automatic Cleanup
- `cleanup_old_data()` runs hourly:
  - Deletes expired/revoked sessions
  - Deletes audit_log entries older than 90 days
  - Deletes alert_logs entries older than 90 days
  - Deletes api_request_log entries older than configured retention
- `events` and `license_plates` are purged separately by the application using their respective retention policies.

---

## 8. Impact & Risk Analysis

### 8.1 Security Risks

| Risk | Severity | Detail |
|---|---|---|
| Credential leakage | **Critical** | `cameras.http_user` (when password was present, now dropped per migration 038), `line_config.*_token/secret`, `users.password_hash`, `sessions.id` — if exposed, an attacker can access cameras, the LINE OA, or impersonate users. |
| Personal data exposure | **Critical** | `license_plates.plate_number`, `users.email`, `audit_log.ip_address` — protected under Thailand PDPA (analogous to GDPR). Requires a Data Sharing Agreement before granting access. |
| Biometric data exposure | **Critical** | Face embeddings (`face_embeddings`, `face_blacklist`) are biometric data — stricter PDPA handling required. |
| Unauthorized writes | **High** | Granting the `vigil_sql` user (DB owner) to 3rd parties allows them to delete events, modify alert rules, or inject fake records. Always use the read-only role. |
| Network exposure | **High** | Port 5432 bound to `0.0.0.0` is reachable from any network interface. Restrict to LAN-only via Docker port binding or firewall. |
| No SSL by default | Medium | DB connections are unencrypted unless SSL is explicitly enabled — credentials traverse the network in plaintext if accessed remotely. |

### 8.2 Performance Risks

| Risk | Severity | Detail |
|---|---|---|
| Unfiltered `events` queries | **High** | Queries without an `event_time` filter perform a table scan over millions of rows, slowing the live ingester. Always use index with `event_time`. |
| Connection pool exhaustion | Medium | The platform's `pg.Pool` has no explicit cap — 3rd parties without their own pool can monopolize connections. |
| Lock contention | Medium | Heavy analytical queries running alongside the ingester's inserts can cause lock waits. Consider read replicas for high-load analytics. |

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
8. **Separate approvals for biometric data** — face recognition data requires explicit user/customer consent per PDPA §26.

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


-- LPR statistics by vehicle type (last 7 days)
SELECT
  DATE(detected_at AT TIME ZONE 'Asia/Bangkok') AS date,
  vehicle_type,
  COUNT(*) AS total,
  SUM(CASE WHEN no_seatbelt THEN 1 ELSE 0 END) AS no_seatbelt,
  SUM(CASE WHEN no_helmet THEN 1 ELSE 0 END) AS no_helmet
FROM license_plates
WHERE detected_at >= NOW() - INTERVAL '7 days'
GROUP BY date, vehicle_type
ORDER BY date DESC, vehicle_type;
```

> **Note:** The queries above use base table names for clarity. 3rd parties should substitute the view names (e.g. `v_events_public`, `v_cameras_public`, `v_license_plates_public`) as documented in the companion integration guide.

---

## 10. Schema Migration Changelog

| Version / Migration | Change |
|---|---|
| `init.sql` v1.0 | Core tables: cameras, events, appearances, license_plates, line_config, alert_rules, alert_logs, users, sessions, audit_log, system_settings, event_categories |
| migration_011 | Added `analytics_event_display` to `system_settings` |
| migration_012 | Added `active_from`, `active_to` (quiet hours) to `alert_rules` |
| migration_013 | Added `report_schedules` table |
| migration_014 | Added `image_layout` to `report_schedules` |
| migration_015 | Added `send_days` (weekly days) to `report_schedules` |
| migration_016 | Added license-related tables |
| migration_017 | Added `auditor` role to `users.role` |
| migration_018 | Added camera offline alert columns |
| migration_019 | Added `escalate_once` config |
| migration_021 | Added `report_history` table |
| migration_022 | Added `health` report type to `report_history` |
| migration_023 | Added pending recipients support to `line_config` |
| migration_024 | Added `target_camera_id` to `audit_log` |
| migration_025 | Backfilled and indexed `snapshot_filename` / `has_snapshot` in `events` |
| migration_026 | Added `oa_basic_id` to `line_config` |
| migration_027 | **Third-party views + role** — 11 `v_*_public` views + `third_party_readonly` NOLOGIN role |
| migration_028 | Added `status = 'blocked'` permanent soft-block to pending recipients |
| migration_029 | Added `mapbox_token` to `system_settings` (Map page, decision #171) |
| migration_030 | Added `pg_trgm` GIN index on `events.event_type` for NOT LIKE optimization |
| migration_031 | Added IVA Pro columns to `appearances` — `hair_length`, `top_category`, `bottom_category`, `glasses`, `helmet_wear`, `object_class` |
| migration_032 | Updated `v_appearances_public` view to include IVA Pro columns |
| migration_033 | Added `hair_color` (human-readable string) to `appearances` |
| migration_034 | Added `appearances_retention_days` to `system_settings` |
| migration_035 | Dropped `snapshot_b64` from `appearances` (wasted disk, never read) |
| migration_036 | Added `vehicle_type`, `vehicle_color`, `vehicle_brand` to `license_plates` (multi-vendor ANPR) |
| migration_037 | Added `paused` flag to `cameras` (maintenance mode) |
| migration_038 | Dropped `http_password`, `rtsp_url` from `cameras` (decision #193, SEC-015) |
| migration_039 | Dropped unused GIN index `idx_events_raw_gin` on `events.raw_json` |
| migration_040 | Dropped trgm index `idx_events_type_trgm` (1 lifetime scan, perf audit 2026-06-06) |
| migration_041–070 | LPR gates, watchlist, alerts, multi-site support, edge status, appearances extensions, reports — see git log and `db/` directory |
| migration_071 | Added keyset index `(event_time DESC, id DESC)` for LPR pagination (decision #211) |
| migration_072 | Added `snapshot_oldest (DATE)`, `snapshot_dirs (INT)` to `edge_status` (decision #214) |
| migration_073 | Added `no_seatbelt (BOOLEAN)` to `license_plates` + partial index (decision #214) |
| migration_074 | Added `rawxml_retention_days = 90` to `system_settings` (class-D retention, decision #212) |
| migration_075 | Added `site_id` to `event_categories` with unique constraint per site |
| migration_076 | Added `is_locked` to `event_categories` (replaces `is_builtin`), migrated categories to VSS site |
| migration_077 | Added `sort_order` to `cameras` for manual grid ordering |
| migration_078 | Changed `site_id` FK in `edge_status` to cascade-delete |
| migration_079 | Normalized `plateColor` casing/tokens in `events.raw_json` |
| migration_080 | Backfilled `object_class` for `anprAlarm` from `license_plates.vehicle_type` mapping |
| migration_081 | Split "Pickup" into separate `object_class` from "Truck" for `anprAlarm` |
| migration_082 | Backfilled face recognition event rows that never got `appearances` inserted |
| migration_083 | Added `nvr_channel`, `capture_categories`, `device_id` to `cameras` (NVR multi-channel support, Phase 3) |
| migration_084 | Added `plate_type` to `license_plates` (Thai plate category by color) |
| migration_085 | Added `plate_color`, `no_helmet` to `license_plates` (perf for `/api/lpr/stats`) |
| migration_086 | Added trigram GIN index on `license_plates.plate_number` (wildcard search) |
| migration_087 | Added `recording_nvr_id` to `cameras` (maps standalone LPR cameras to recording NVR) |
| migration_088 | Added `vehicle_type` column to `event_category_rules` (LPR category matching) |
| migration_089 | Denormalized `vehicle_type` into `events` for stats perf, backfilled `anprAlarm` rows |
| migration_090 | Added `rider_count` to `license_plates` for Dahua ITC431 multi-rider detection + partial index |
| migration_091 | Added `model_detected_at`, `model_detect_error` to `cameras` (auto-detect audit trail) |
| migration_092 | Added index on `license_plates.detected_at` (Executive Summary KPI queries) |
| migration_093 | **Blacklist schema** — `blacklist.sources`, `.source_records`, `.master`, `.master_links` + PII encryption + origin tracking |
| migration_094 | Added `blacklist.overrides`, `plate_dedup_key` (local correction layer) + push-back gate |
| migration_095 | Revised `case_ref`, `display_name` semantics in `blacklist.source_records` / `.master` per source type |
| migration_096 | Added `blacklist.bridge_rules` (connect blacklist sources to watchlist groups) |
| migration_097 | Created `metrics_host` table (time-series CPU/RAM/disk/network, ~1.58M rows/year) |
| migration_098 | Added `last_svc_result` to `edge_status` (MQTT command result feedback) |
| migration_099 | Moved `alert_mode` from plate level to `lpr_watchlist_groups` + `default_alert_mode` (migration 112 context) |
| migration_100 | Added `storage_json` to `edge_status` (mdraid/mount status) |
| migration_101 | Added `tunnel_up`, `tailscale_up` to `metrics_host` (connectivity metrics) |
| migration_102 | Created `camera_httphost_backups` (append-only log of ANPR repointing) |
| migration_103 | Added partial expression index on `events` for Dahua FaceDetector/Comparison (66.5s→5.5s appearance search) |
| migration_104 | Added functional index `UPPER(plate_number)` to `license_plates` (1.13s→0.046s alert counting) |
| migration_105 | Adjusted `events` autovacuum (`scale_factor 0.02`, `cost_limit 2000`) for 370k rows/day ingest |
| migration_106 | Added `kept_types` to `blacklist.sources` (hide deprecated types without deletion) |
| migration_107 | Added auto-sync schedule + push options to `blacklist.sources` (`pull_interval_hours`, `push_types`, `push_mode`, `push_auto_enabled`) |
| migration_108 | Parsed Dahua rawXml ANPR fields into columns (`plate_char_believe`, `license_bright`) |
| migration_109 | Added per-site retention policy to `sites` (`retention_events_days`, `retention_lpr_days`, `retention_face_days`, `retention_min_free_gb`) |
| migration_110 | Added `retention_json`, `last_prune_json` to `edge_status` (edge pruning feedback) |
| migration_111 | Added `inventory_json` to `edge_status` (per-folder snapshot inventory from edge) |
| migration_112 | **LPR watchlist + alerts** — `lpr_watchlist`, `lpr_watchlist_groups`, `lpr_alert_acks`, `lpr_alert_cooldown`, `lpr_alert_hourly` + LINE delivery |
| migration_113 | Added `notify_line` to `lpr_watchlist` (per-entry alert control) |
| migration_114 | Added `lpr_line_image_expire_hours` to `system_settings` (imgbb image TTL for LPR alerts) |
| migration_115 | Added `sd_detail_json` to `cameras` (microSD status in vendor-specific format) |
| migration_116 | Added `max_hold_sec`, `max_hold_at` to `cameras` (event buffer max hold time) |
| migration_117 | Added vehicle-level bounding box + 3 display toggles to `license_plates` + `system_settings` |
| migration_118 | Fixed missing `third_party_readonly` role grants to `v_*_public` views |
| migration_119 | **Partner API consumers** — `api_consumers`, `api_request_log` (Phase TP1a) |
| migration_120 | Updated `v_cameras_public` view (narrower, no internal columns), added `max_lookback_days` + `site_codes` scoping to `api_consumers` |
| migration_121 | Added `(detected_at, id)` cursor paging index to `appearances` |
| migration_122 | Added `api_log_retention_days` to `system_settings` (Partner API audit retention) |
| migration_123 | Added `expires_at` to `api_consumers` (credential expiry, decision #234) |
| migration_124 | Added "manual" source type to `blacklist.sources` (user-typed plates) |
| migration_125 | Clarified `snapshot_retention_days` in `system_settings` (central disk only, not edge) |
| migration_126 | Created `hcp_camera_map` (HCP camera index → platform camera ID mapping) |
| migration_127 | Added `alert_rules` entries for HCP face detection alerts |
| migration_128 | Added `vanished_at` + `data_hash` to `blacklist.source_records` (track disappearing records) |
| migration_129 | **Face recognition** — `face_embeddings`, `face_blacklist`, `face_embed_queue` (AuraFace-v1, pgvector) |
| migration_130 | Added `alert_rules` for AuraFace-v1 blacklist match alerts |
| migration_131 | Denormalized `camera_id` into `face_embeddings`, `face_embed_queue` (query perf) |
| migration_132 | Added `vec_dot()` SQL function to fix performance regression from migration 131 (GOTCHAS #149) |
| migration_133 | Added `enrolled_ref` to `face_blacklist` (prevent re-enrollment from same batch) |
| migration_134 | Created `face_blacklist_hits` (match audit log) |
| migration_135 | Added AuraFace-v1 threshold to `system_settings` |
| migration_136 | Backfilled `enrolled_ref` for initial HCP batch |
| migration_137 | Created `face_blacklist_groups` + added `notify_line` to `face_blacklist` (grouping + LINE alerts) |
| migration_138 | Added `(camera_id, time_bucket)` index to `face_embed_queue` (dedup + speed) |
| migration_139 | Added `UNIQUE(time_bucket)` constraint to `face_embed_queue` (prevent race-condition duplicates) |
| migration_140 | Added `AFTER UPDATE` trigger on `users.password_hash` — logs all changes to `audit_log`, exception-safe |
| migration_141 | Added `nav_hidden_pages = '["media"]'` to `system_settings` (menu hiding, decision #239) |
| migration_142 | Created `traffic_hourly_stats` table (vehicle type, seatbelt, helmet, rider-count pre-aggregates for Traffic Enforcement page, decision #237) |
| migration_143 | Per-user view authorization (decision #250-#255) (2026-08-12) |
| migration_144 | Created `event_kpi_hourly` (hourly KPI rollup) (2026-08-12) |
| migration_145 | Per-rule LINE alert card layout (2026-08-13) |
| migration_146 | Built-in, undeletable alert channel rules (2026-08-13) |
| migration_147 | Added `signed_image_expire_hours` + a verifiable imgbb fallback (2026-08-13) |
| migration_148 | Roster pull interval expressed in minutes (2026-08-13) |
| migration_149 | Full roster field + photo overrides (2026-08-13) |
| migration_150 | BS2 - retroactively move source-deleted rows to trash (2026-08-13) |
| migration_151 | CH1 - change history for what the source did to a record (2026-08-13) |
| migration_152 | AcuSeek query logging (2026-08-14) |
| migration_153 | AcuSeek - record terms that were recognised but unused (2026-08-14) |
| migration_154 | Prune status rows for cameras nobody owns any more (2026-08-15) |
| migration_155 | Added `reported_by` to camera status (who reported it) (2026-08-15) |
| migration_156 | FK camera status to the `cameras` table (2026-08-15) |
| migration_157 | Covering index for the "no helmet" ranking page (2026-08-16) |
| migration_158 | Extended statistics on `no_helmet` x `vehicle_type` (2026-08-16) |
| migration_159 | Added `brand_footer_logo` setting (2026-08-17) |
| migration_160 | Per-camera snapshot source mode (2026-08-18) |
| migration_161 | FB1 - bridge rules from blacklist to `face_blacklist` (2026-08-19) |
| migration_162 | One bridge-owned `face_blacklist` row per identity (unique) (2026-08-19) |
| migration_163 | **Created `event_dim_bucket`** - 30-min rollup by the dimensions category rules use (see 3.44) (2026-08-19) |
| migration_164 | Per-camera ONVIF metadata crop (Bosch only) (2026-08-19) |
| migration_165 | Per-camera object-trail overlay (2026-08-20) |
| migration_166 | Pin a bridged plate to the alert group a human chose (2026-08-20) |
| migration_167 | Partial index for the "watch-list person" tab on the Face page (2026-08-21) |
| migration_168 | Partial index for the face-recognition tab (`?hits_only=1`) (2026-08-22) |
| migration_169 | Added source-photo sha1 to bridge-owned `face_blacklist` rows (2026-08-22) |
| migration_170 | Traffic helmet evidence table (usable-as-evidence counts next to totals) (2026-08-23) |
| migration_171 | **Created `lpr_hourly_stats` + `lpr_dim_daily`** - LPR page rollups (see 3.45) (2026-08-23) |
| migration_172 | Added `image_source` to `report_history` (report PNG served from our own domain) (2026-08-24) |
| migration_173 | Model/firmware re-detect interval (2026-08-24) |
| migration_174 | Default LINE recipient (2026-08-24) |
| migration_175 | Per-report LINE send toggles for face/lpr reports (2026-08-24) |
| migration_176 | **Created `storage_stats`** (see 3.43) (2026-08-24) |
| migration_177 | Report PNG retention as a setting (`report_retention_days`) (2026-08-24) |
| migration_178 | Added orphan-snapshot counters to `storage_stats` (2026-08-24) |
| migration_179 | **Created `public_files`** - admin-uploadable file host (see 3.42) (2026-08-24) |
| migration_180 | Per-user camera selection mode (2026-08-27) |
| migration_181 | Per-role `statement_timeout` safety net against hung queries (2026-08-27) |
| migration_182 | Trimmed `cameras` indexes to allow HOT updates (2026-08-27) |
| migration_183 | Added `event_categories.stat_group` (2026-08-29) |
| migration_184 | Covering index for the Events `object_class` filter (2026-08-30) |
| migration_185 | Added `carto_api_key` setting (2026-08-31) |
| migration_186 | Added host spec (CPU, RAM, OS) to `edge_status` (2026-08-31) |
| migration_187 | Added per-alert recipients to `alert_logs` (2026-08-31) |
| migration_188 | Durable "lost contact" state on `edge_status` (2026-08-31) |
| migration_189 | Added `sites.sort_order` (2026-08-31) |
| migration_190 | Created `idx_lpr_plate_type` for the LPR vehicle-type filter (2026-08-31) |
| migration_191 | Dahua `PassengerCar` means bus, not sedan (backfill) (2026-08-31) |
| migration_192 | Dropped an index created from a wrong diagnosis (`vtype`) (2026-08-31) |
| migration_193 | Composite index (camera, vehicle_type, time) on `license_plates` (2026-08-31) |
| migration_194 | `license_plates`: lane and pillion passenger become real columns (2026-09-01) |
| migration_195 | Indexes for lane and pillion passenger (2026-09-01) |
| migration_196 | Login lockout knobs in `system_settings` (2026-09-03) |
| migration_197 | CR.5 - added the `'summary'` report type (2026-09-03) |
| migration_198 | **Dropped `idx_lpr_plate_type`** created by migration 190 - never used (2026-09-06) |
| migration_199 | **Created `idx_events_anpr_noread_time`** - partial index for the LPR "no plate read" tab (see 3.3) (2026-09-06) |

> No gaps in 143-199 (checked 2026-09-06). Dates come from each file's first commit
> (`git log --format=%ad --date=short -- <file> | tail -1`) - when the file was written,
> not when it ran on production.

---

<sub>End of REF_database-schema_EN.md · Vigil Platform v1.5.4 · Last updated 2026-09-06</sub>
