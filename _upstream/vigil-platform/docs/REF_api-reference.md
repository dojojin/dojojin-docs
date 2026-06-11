# REF_api-reference.md — Vigil Platform API Reference

> Complete REST API reference for `src/api-server.js` (Express 5, port 3000).
>
> **Base URL:** `http://localhost:3000` (or `https://dashboard.dojojin.tech` via Cloudflare Tunnel)
>
> Last updated: 2026-06-08 · v1.5.3

---

## Authentication

All endpoints (except those marked **Public**) require a valid session.

### How to authenticate

Provide the session token using **one** of these methods (checked in order):

| Method | Header / Cookie |
|---|---|
| Cookie | `Cookie: session=<token>` |
| Bearer header | `Authorization: Bearer <token>` |
| URL token | `?token=<token>` (legacy — URL-token routes only) |

The login endpoint returns `{ token }` in the body and also sets a `session` cookie.

### Role levels

| Role | Scope |
|---|---|
| `admin` | Full read/write access to all endpoints |
| `auditor` | Read-only: can call GET endpoints; POST/PUT/DELETE/PATCH return 403 |
| `viewer` | Dashboard access; credentials redacted from camera responses |

In this document:
- **Public** — no auth required
- **Any auth** — any authenticated user (`admin`, `auditor`, or `viewer`)
- **Admin/Auditor** — `requireAdminOrAuditor`
- **Admin** — `requireAdmin`

---

## Table of Contents

1. [Auth](#1-auth)
2. [Users](#2-users)
3. [Cameras](#3-cameras)
4. [Camera Groups](#4-camera-groups)
5. [Events](#5-events)
6. [Appearances (Person Attributes)](#6-appearances-person-attributes)
7. [Face Capture](#7-face-capture)
8. [Event Categories & Mapping Rules](#8-event-categories--mapping-rules)
9. [Statistics](#9-statistics)
10. [LINE Notifications](#10-line-notifications)
11. [Alert Rules & Logs](#11-alert-rules--logs)
12. [Push Notifications (Mobile)](#12-push-notifications-mobile)
13. [Reports](#13-reports)
14. [System Health Report](#14-system-health-report)
15. [Settings](#15-settings)
16. [Branding](#16-branding)
17. [Map](#17-map)
18. [License & EULA](#18-license--eula)
19. [Health & Services](#19-health--services)
20. [Backups](#20-backups)
21. [Media & Snapshots](#21-media--snapshots)
22. [Audit Log](#22-audit-log)

---

## 1. Auth

### POST /api/auth/login
**Public** — rate-limited: 10 attempts/min per IP.

**Body**
```json
{ "username": "admin", "password": "secret" }
```

**Response**
```json
{
  "success": true,
  "token": "<session-token>",
  "user": { "id": 1, "username": "admin", "role": "admin" }
}
```
Also sets `session=<token>` cookie (HttpOnly, SameSite=Lax; Secure over HTTPS).

---

### POST /api/auth/logout
**Public** — invalidates the current session token and clears the cookie.

**Response** `{ "success": true }`

---

### GET /api/auth/me
**Public** — returns the current user if authenticated; 401 if not.

**Response** `{ "user": { "id", "username", "role" } }` or `401`

---

### POST /api/auth/change-password
**Any auth** — change own password.

**Body** `{ "oldPassword": "...", "newPassword": "..." }`

**Response** `{ "success": true }` or `400` with `{ "error": "..." }`

---

### GET /api/auth/sessions
**Any auth** — list own active sessions. Full session IDs are truncated to first 8 chars.

**Response** `[ { "id": "abc12345...", "ip_address", "user_agent", "is_current": true, "created_at" } ]`

---

### POST /api/auth/sessions/:id/revoke
**Any auth** — revoke a session by its 8-char prefix.

**Response** `{ "success": true }`

---

## 2. Users

### GET /api/users
**Admin/Auditor** — list all users.

**Response** `[ { "id", "username", "role", "created_at" } ]`

---

### POST /api/users
**Admin**

**Body** `{ "username": "jane", "password": "...", "role": "viewer" }`
`role`: `admin` | `auditor` | `viewer`

**Response** `{ "id", "username", "role", "created_at" }`

---

### PUT /api/users/:id
**Admin** — update username, role, or password fields.

**Body** (any subset) `{ "username", "role", "password" }`

**Response** updated user object

---

### POST /api/users/:id/reset-password
**Admin**

**Body** `{ "newPassword": "..." }`

**Response** `{ "success": true }`

---

### DELETE /api/users/:id
**Admin**

**Response** `{ "success": true }`

---

## 3. Cameras

> Camera config (credentials, lat/lon, vendor) lives in `cameras-config.json`.
> Runtime state (heartbeat, recording) lives in the `cameras` DB table.
> `GET /api/cameras` merges both sources.

### GET /api/cameras
**Any auth** — list all configured cameras with merged runtime state.
Admin gets plaintext credentials; viewer/auditor get `***` for `password`, `mqtt_password`.

**Response array fields**

| Field | Type | Notes |
|---|---|---|
| `camera_id` | string | Unique ID (MQTT topic key) |
| `camera_name` | string | Display name |
| `ip_address` | string | |
| `vendor` | string | `bosch` \| `hikvision` \| `dahua` \| `onvif` |
| `status` | string | `online` \| `offline` \| `paused` |
| `last_seen` | ISO timestamp \| null | Last heartbeat |
| `paused` | boolean | Maintenance pause flag |
| `recording` | boolean | SD card actively recording (ONVIF) |
| `enable_snapshot` | boolean | |
| `enable_clip_capture` | boolean | |
| `clip_pre_sec` / `clip_post_sec` | int | Pre/post-event clip duration |

---

### POST /api/cameras
**Admin** — add a new camera.

**Query params**
- `?force=1` — bypass duplicate-IP or non-ASCII camera_id warnings

**Body** (required: `camera_id`)
```json
{
  "camera_id": "BOSCH_CAM_01",
  "camera_name": "Main Entrance",
  "ip_address": "192.168.1.100",
  "vendor": "bosch",
  "username": "admin",
  "password": "secret",
  "lat": 13.75,
  "lon": 100.52,
  "location": "Building A"
}
```

**Response** merged camera object

**Warning response (409)** — soft-block before `?force=1`:
```json
{
  "warnings": [ { "code": "duplicate_ip", "message_th": "..." } ],
  "suggested_camera_id": "BOSCH_CAM_01"
}
```

---

### DELETE /api/cameras/:cameraId
**Admin** — remove camera from config. Preserves historical events in DB.

**Response** `{ "success": true }`

---

### PATCH /api/cameras/:cameraId/pause
**Admin** — toggle maintenance pause.

**Body** `{ "paused": true }`

**Response** `{ "success": true, "paused": true }`

---

### POST /api/cameras/:id/mqtt/regenerate
**Admin** — regenerate MQTT credentials for a Bosch camera and re-provision in EMQX.

**Response** `{ "success": true, "mqtt_username": "cam-bosch-cam-01" }`

---

### POST /api/cameras/test-connection
**Admin** — probe camera reachability before saving.

**Body** `{ "vendor": "hikvision", "ip_address": "192.168.1.100", "username": "admin", "password": "..." }`

**Response** `{ "ok": true, "latency_ms": 42 }` or `{ "ok": false, "error": "..." }`

---

### POST /api/cameras/snapshot-preview
**Admin** — fetch a live JPEG from the camera for preview in the settings form.

**Body** `{ "camera_id": "..." }` (uses stored credentials)

**Response** JPEG binary (`Content-Type: image/jpeg`)

---

### POST /api/cameras/probe-snapshot
**Admin** — one-shot snapshot probe with explicit credentials (before saving camera).

**Body** `{ "vendor", "ip_address", "username", "password" }`

**Response** JPEG binary

---

### GET /api/cameras/status-current
**Admin/Auditor** — current online/offline status for all cameras (from DB `cameras` table).

**Response** `[ { "camera_id", "status", "last_seen_at", "paused" } ]`

---

### GET /api/cameras/status-log
**Any auth** — online↔offline transition history (90-day retention).

**Query params**
- `cameraId` — filter by camera
- `limit` (default 100)

**Response** `[ { "id", "camera_id", "status", "reason", "changed_at" } ]`

---

### GET /api/cameras/image-quality-log
**Admin/Auditor** — 24h camera auto-analytics counts (too_bright, too_blurry, too_dark, scene_change).

**Response** `[ { "camera_id", "too_bright", "too_blurry", "too_dark", "scene_change" } ]`

---

### GET /api/camera-offline-alerts/:cameraId
**Any auth** — offline alert configuration for a camera.

**Response**
```json
{
  "camera_id": "BOSCH_CAM_01",
  "enabled": false,
  "notify_after_sec": 300,
  "escalate_interval_min": 60,
  "escalate_once": false,
  "quiet_from": null,
  "quiet_to": null,
  "recipient_ids": ""
}
```

---

### PUT /api/camera-offline-alerts/:cameraId
**Admin** — update offline alert config for a camera.

**Body** (any subset of the fields above)

**Response** `{ "success": true }`

---

## 4. Camera Groups

Groups are stored in `cameras-config-groups.json` (not DB). Writes require admin.

### GET /api/groups
**Any auth**

**Response** `[ { "id", "name", "color", "cameraIds": ["CAM1", "CAM2"], "created_at" } ]`

---

### POST /api/groups
**Admin** — create or update a group (upsert by `id`).

**Body**
```json
{ "id": "g_1234", "name": "Building A", "color": "#00b4ff", "cameraIds": ["CAM1", "CAM2"] }
```
Omit `id` to auto-generate.

**Response** `{ "success": true, "group": { ... } }`

---

### DELETE /api/groups/:groupId
**Admin**

**Response** `{ "success": true }`

---

## 5. Events

### GET /api/events
**Any auth** — paginated event list.

**Response headers**
- `X-Total-Count` — total matching rows (before LIMIT/OFFSET)

**Query params**

| Param | Type | Notes |
|---|---|---|
| `limit` | int | Default 100 |
| `offset` | int | Default 0 |
| `from` | ISO timestamp | Inclusive lower bound on `event_time` |
| `to` | ISO timestamp | Inclusive upper bound on `event_time` |
| `camera` | string | Single camera_id |
| `cameras` | CSV | Multiple camera IDs: `CAM1,CAM2` |
| `type` | string | Partial match on `event_type` (LIKE `%type%`) |
| `cls` | string | Exact `object_class` |
| `object_classes` | CSV | Multiple classes including group aliases (`Person,Vehicle`) |
| `rule_name` | string | Exact match |
| `rule_names` | CSV | Multiple rule names |
| `category_id` | int | Events matching any rule in this category |
| `hasSnapshot` | `true` | Filter to events with snapshot only |
| `hasClip` | `true` | Filter to events with completed clip only |
| `tab` | string | `snap` \| `no_snap` \| `lpr` \| `clip` |
| `q` | string | Free-text search across rule_name, camera_id, object_class, event_type |
| `dow` | int | Day-of-week filter: 0=Mon … 6=Sun (heatmap drill-down) |
| `hour` | int | Hour-of-day filter: 0–23 (heatmap drill-down) |

**Response array** — `events` table row plus:

| Field | Notes |
|---|---|
| `snapshot_file` | Coalesced from `snapshot_filename` and `raw_json->>'_snapshot'` |
| `snapshot_source` | `raw_json->>'_snapshot_source'` |

---

### GET /api/events/facets
**Any auth** — distinct values for filter dropdowns (cameras, event_types, rule_names, object_classes).

**Response**
```json
{
  "cameras": ["CAM1", "CAM2"],
  "event_types": ["LineDetector/Crossed", "FieldDetector/ObjectsInside"],
  "rule_names": ["WrongWay", "NoEntry"],
  "object_classes": ["Person", "Car"]
}
```

---

### GET /api/events/:id/appearance
**Any auth** — appearance attributes for a specific event.

**Response** `{ "id", "event_id", "gender", "age", "clothing_upper_color", ... }` or 404

---

## 6. Appearances (Person Attributes)

### GET /api/appearances/stats
**Any auth** — aggregate appearance statistics.

**Query params** `from`, `to`, `camera_id`

**Response** gender counts, age-band counts, top clothing colors, etc.

---

### GET /api/appearances/search
**Any auth** — search appearances by attribute.

**Query params** `gender`, `age_min`, `age_max`, `clothing_upper_color`, `from`, `to`, `camera_id`, `limit`, `offset`

**Response headers** `X-Total-Count`

**Response** `[ { event_id, event_time, camera_id, gender, age, clothing_upper_color, snapshot_file, ... } ]`

---

## 7. Face Capture

> Hikvision Smart Event — FaceCapture events with demographic attributes.

### GET /api/faces
**Any auth** — paginated face capture list.

**Query params** `from`, `to`, `camera_id`, `gender`, `age_min`, `age_max`, `limit` (max 200), `offset`

**Response headers** `X-Total-Count`

**Response**
```json
[ {
  "id", "event_time", "camera_id",
  "snapshot", "snapshot_full",
  "age", "age_group", "gender", "expression",
  "glass", "mask", "hat",
  "stay_duration", "face_score",
  "clip_file", "clip_status"
} ]
```

---

### GET /api/faces/summary
**Any auth** — demographic summary for the same filter set as `/api/faces`.

**Query params** same as `/api/faces`

**Response**
```json
{
  "total": 120,
  "male": 75, "female": 45,
  "masked": 10,
  "age_teen": 5, "age_young": 60, "age_mid": 40, "age_senior": 15
}
```

---

## 8. Event Categories & Mapping Rules

> Categories created by the operator map raw events into display groups.
> Writes require admin. Reads are open to any authenticated user.

### GET /api/categories
**Any auth** — list all categories with rule counts.

**Response**
```json
[ {
  "id", "name", "icon", "color", "kind",
  "is_builtin": false,
  "sort_order": 0,
  "rule_count": 3,
  "created_at", "updated_at"
} ]
```

---

### POST /api/categories
**Admin**

**Body** `{ "name": "People Counting", "icon": "👤", "color": "#5b8def", "sort_order": 0 }`

**Response** new category row. `409` if name already exists.

---

### PUT /api/categories/:id
**Admin** — update category. Built-in categories (`is_builtin=true`) cannot have their `name` changed.

**Body** (any subset) `{ "name", "icon", "color", "sort_order" }`

---

### DELETE /api/categories/:id
**Admin** — `403` if `is_builtin=true`.

---

### GET /api/categories/:id/rules
**Any auth** — list mapping rules for a category.

**Response**
```json
[ {
  "id", "category_id",
  "camera_id": null,
  "rule_name": null,
  "event_type": "LineDetector/Crossed",
  "object_class": "Person",
  "match_state": null,
  "priority": 0
} ]
```
`null` fields are wildcards.

---

### POST /api/categories/:id/rules
**Admin** — add a mapping rule.

**Body**
```json
{
  "camera_id": null,
  "rule_name": null,
  "event_type": "LineDetector/Crossed",
  "object_class": "Person",
  "match_state": null,
  "priority": 0
}
```
Omit a field or pass `""` / `null` = wildcard.
`match_state` defaults to `"true"` when the field is **omitted**; pass `""` or `null` explicitly for "any".

---

### DELETE /api/category-rules/:id
**Admin** — delete a mapping rule by its own `id`.

---

## 9. Statistics

All stats endpoints are **Any auth**. Common query params:

| Param | Type | Notes |
|---|---|---|
| `from` | ISO timestamp | Start of window |
| `to` | ISO timestamp | End of window |
| `cameras` | CSV | Camera filter: `CAM1,CAM2` |

---

### GET /api/stats/today-counts
Today's event counts by camera (midnight in `display_timezone` → now). 30s TTL cache.

**Response** `{ "total": 500, "tz": "Asia/Bangkok", "cameras": { "CAM1": { "total", "persons", "vehicles", "last_event" } } }`

---

### GET /api/stats/kpi
KPI cards for a date range.

**Response** `{ "total_events", "alerts", "persons", "vehicles", "traffic_violations" }`

---

### GET /api/stats/timeline
Event + alert time series. `granularity`: `hour` (default) | `day` | `week`.

**Response** `[ { "bucket": ISO, "total": int, "alerts": int } ]`

---

### GET /api/stats/timeline-v2
Same as timeline but includes `category_id` filter and returns per-hour buckets with display_tz alignment.

**Query params** `from`, `to`, `cameras`, `category_id`, `granularity`

---

### GET /api/stats/breakdown
Event count breakdown by event_type + object_class.

**Response** `[ { "event_type", "object_class", "count" } ]`

---

### GET /api/stats/breakdown-v2
Breakdown with additional `rule_name` grouping.

**Query params** `from`, `to`, `cameras`, `category_id`

---

### GET /api/stats/categories
Category KPI counts (events matching each category's rules).

**Query params** `from`, `to`, `cameras`

**Response** `{ "categories": [ { "id", "name", "icon", "color", "kind", "count" } ] }`

---

### GET /api/stats/dwell
Zone dwell time — pairs `FieldDetector/ObjectsInside` `event_state` true→false per
(camera, rule) via window function (Data Enrichment Ph.1, 2026-06-10). Pairs wider
than 24h are discarded (state loss). Dahua emits enter-only today → no pairs until Ph.2.

**Query params** `from`, `to`, `camera_id` (optional), `episodes=true` + `limit` (≤500) for raw episode list

**Response (summary)** `[ { "camera_id", "rule_name", "episodes", "avg_sec", "max_sec", "min_sec", "total_sec" } ]`
**Response (episodes)** `[ { "camera_id", "rule_name", "start_time", "end_time", "dwell_sec" } ]`

---

### GET /api/stats/heatmap
Hour-of-week activity heatmap (0=Mon … 6=Sun, 0–23h).

**Query params** `from`, `to`, `cameras`, `category_id`

**Response** `[ { "dow": 0, "hour": 9, "count": 42 } ]`

---

### GET /api/stats/per-camera-counts
Event count per camera.

**Query params** `from`, `to`, `cameras`, `category_id`

**Response** `[ { "camera_id", "count" } ]`

---

### GET /api/stats/top-rules
Most-fired rule names.

**Query params** `from`, `to`, `cameras`, `limit` (default 10)

**Response** `[ { "rule_name", "count" } ]`

---

### GET /api/stats/quiet-cameras
Cameras with no events in the given window.

**Query params** `from`, `to`

**Response** `[ { "camera_id" } ]`

---

### GET /api/stats/timeline-by-category
One time series per category.

**Query params** `from`, `to`, `cameras`, `granularity`

**Response** `{ "series": [ { "category_id", "name", "color", "data": [ { "bucket", "count" } ] } ] }`

---

### GET /api/stats/timeseries-rules
Event time series grouped by rule_name.

**Query params** `from`, `to`, `cameras`, `granularity`

---

### GET /api/stats/executive-summary
Summary stats for the Executive Summary page — KPI, camera status, top events. No required params.

**Response** multi-section summary object.

---

### GET /api/stats/occupancy
Occupancy zone stats (ONVIF occupancy counting cameras).

**Query params** `from`, `to`, `cameras`

---

### GET /api/stats/occupancy/sources
Available occupancy data sources.

---

### GET /api/stats/occupancy/timeline
Occupancy time series per zone.

**Query params** `from`, `to`, `cameras`, `granularity`

---

### GET /api/stats/occupancy/heatmap
Occupancy hour-of-week heatmap.

**Query params** `from`, `to`, `cameras`

---

## 10. LINE Notifications

### GET /api/line-config
**Admin/Auditor** — returns LINE config with masked secrets (last 12 chars of token, last 8 of secret).

**Response**
```json
{
  "id": 1,
  "channel_access_token": "••••••••<last12>",
  "channel_secret": "••••••••<last8>",
  "imgbb_api_key": "••••••••<last6>",
  "oa_basic_id": "@MyOA",
  "enabled": true,
  "recipients": [ { "id": "U...", "type": "user", "name": "Alice", "enabled": true } ],
  "_hasToken": true,
  "_hasSecret": true,
  "_hasImgbb": true
}
```

---

### PUT /api/line-config
**Admin** — update LINE config. Fields with `••` prefix are ignored (masked values returned from GET).

**Body** (any subset)
```json
{
  "channel_access_token": "...",
  "channel_secret": "...",
  "imgbb_api_key": "...",
  "oa_basic_id": "@MyOA",
  "enabled": true,
  "recipients": [ { "id": "U...", "type": "user", "name": "Alice", "enabled": true } ]
}
```

**Response** `{ "success": true }`

> Removing a recipient also resets their `pending_recipients` status to `"ignored"` so they can re-register.

---

### GET /api/line-config/quota
**Any auth** — LINE Messaging API monthly quota.

**Response** `{ "connected": true, "type": "limited", "value": 500, "totalUsage": 123 }` or `{ "connected": false }`

---

### POST /api/line-config/test
**Admin** — send a test LINE message.

**Body** `{ "recipientId": "U..." }`

**Response** `{ "success": true }` or error

---

### GET /api/line-config/qr
**Any auth** — QR code PNG for LINE OA friend-add. Requires `oa_basic_id` to be set.

**Response** PNG image (`Content-Type: image/png`)

---

### Recipient Onboarding

#### GET /api/line/pending
**Admin** — list pending self-service recipient requests (status = `pending`).

**Response** `[ { "line_id", "source_type", "display_name", "avatar_url", "first_seen_at", "last_message_at", "message_count", "status" } ]`

---

#### POST /api/line/pending/:id/approve
**Admin** — approve a pending recipient and add to `line_config.recipients`. Sends a confirmation LINE message.

**Body** `{ "name": "Alice" }` (optional — overrides display_name)

**Response** `{ "success": true, "recipient": { "id", "type", "name", "enabled": true } }`

---

#### POST /api/line/pending/:id/ignore
**Admin** — dismiss a pending request without blocking.

**Response** `{ "success": true }`

---

#### POST /api/line/pending/:id/block
**Admin** — block a LINE ID from future self-service requests.

**Response** `{ "success": true }`

---

#### GET /api/line/blocked
**Admin** — list blocked LINE IDs.

---

#### POST /api/line/blocked/:id/unblock
**Admin** — move blocked → ignored (allows future re-registration).

---

### POST /api/line/webhook
**Public** — LINE Platform webhook endpoint. Validates `X-Line-Signature` (HMAC-SHA256 of raw body using `channel_secret`). Handles `message`, `follow`, `unfollow`, `join`, `leave`, `postback` events.

---

## 11. Alert Rules & Logs

### GET /api/alert-rules
**Any auth** — list all alert rules, active first.

**Response**
```json
[ {
  "id", "name", "enabled",
  "camera_ids": ["CAM1"],
  "rule_names": ["WrongWay"],
  "recipient_ids": ["U..."],
  "cooldown_seconds": 60,
  "send_snapshot": true,
  "push_user_ids": [1],
  "message_template": "🚨 {camera}\n...",
  "active_from": "22:00",
  "active_to": "06:00",
  "created_at"
} ]
```

> `active_from` / `active_to` = **quiet hours** (LINE is SILENCED during this window), not active hours.

---

### POST /api/alert-rules
**Admin**

**Body**
```json
{
  "name": "Night Intruder Alert",
  "enabled": true,
  "camera_ids": ["CAM1"],
  "rule_names": ["WrongWay"],
  "recipient_ids": ["U..."],
  "cooldown_seconds": 60,
  "send_snapshot": true,
  "push_user_ids": [1],
  "message_template": "🚨 {camera}\n📋 {rule}\n📍 {location}\n⏰ {time}",
  "active_from": "22:00",
  "active_to": "06:00"
}
```
`camera_ids` / `rule_names` / `recipient_ids`: empty array = match all.
`active_from` / `active_to`: `HH:MM` format or null. Both null = no quiet hours.

**Response** new alert rule row

---

### PUT /api/alert-rules/:id
**Admin** — partial update. Same fields as POST.

**Response** updated rule row or `404`

---

### DELETE /api/alert-rules/:id
**Admin**

---

### GET /api/alert-rules-suggestions
**Any auth** — distinct rule_names from recent events for autocomplete.

**Response** `[ "WrongWay", "NoEntry", ... ]`

---

### GET /api/alert-logs
**Admin/Auditor**

**Query params**
- `ruleId` — filter by rule
- `cameraId` — filter by camera
- `status` — `success` | `failed` | `cooldown_skip` | `quiet_hours_skip` | `no_recipients` | `disabled`
- `since` — ISO timestamp lower bound
- `limit` (default 100)

**Response** `[ { "id", "rule_id", "camera_id", "event_id", "status", "sent_at", "recipient_count", "duration_ms", "error" } ]`

---

### GET /api/alert-logs/stats
**Any auth**

**Query params** `window`: `24h` (default) | `7d` | `30d`

**Response**
```json
{
  "window": "24h",
  "success": 45, "failed": 2,
  "cooldown_skip": 10, "quiet_hours_skip": 3,
  "no_recipients": 0, "disabled": 0,
  "total": 60,
  "line_messages_sent": 45,
  "avg_duration_ms": 312,
  "success_rate": 96
}
```

---

### DELETE /api/alert-logs
**Admin** — purge alert logs.

**Query params** `olderThanDays` — delete logs older than N days (omit to delete all)

**Response** `{ "success": true, "deleted": 150 }`

---

## 12. Push Notifications (Mobile)

### POST /api/push/register
**Any auth** — register a device for push notifications (FCM/APNs via Vigil Mobile).

**Body** `{ "token": "<device-token>", "platform": "ios" | "android" }`

**Response** `{ "success": true }`

---

### POST /api/push/unregister
**Any auth** — remove a push token.

**Body** `{ "token": "<device-token>" }`

**Response** `{ "success": true }`

---

## 13. Reports

### GET /api/report-schedules
**Any auth** — list scheduled LINE report deliveries.

**Response**
```json
[ {
  "id", "report_type": "daily",
  "enabled": true,
  "send_time": "08:00",
  "recipients": "U...",
  "image_layout": "compact",
  "send_day_of_week": null,
  "send_days_of_month": null,
  "health_sections": null,
  "created_at"
} ]
```

---

### POST /api/report-schedules
**Admin**

**Body**
```json
{
  "report_type": "daily",
  "enabled": true,
  "send_time": "08:00",
  "recipients": "U...",
  "image_layout": "compact",
  "send_day_of_week": 0,
  "send_days_of_month": "1,15,L",
  "health_sections": ["cameras","storage"]
}
```

- `report_type`: `daily` | `weekly` | `monthly` | `health`
- `image_layout`: `compact` | `full` (analytics reports only; null for health)
- `send_day_of_week`: `0`=Mon … `6`=Sun (weekly gate; null = any day)
- `send_days_of_month`: CSV of `1..31` or `L` (last day); null = any day
- `health_sections`: array of `cameras` | `alerts` | `storage` | `system` (health type only)

---

### PUT /api/report-schedules/:id
**Admin** — partial update. Same fields as POST.

---

### DELETE /api/report-schedules/:id
**Admin**

---

### POST /api/report-schedules/:id/run
**Admin** — trigger a schedule to run immediately (async via report-worker).

**Response** `{ "ok": true }` or `503` if report-worker unavailable

---

### GET /api/report-history
**Admin/Auditor** — paginated list of sent reports.

**Query params** `limit` (default 50), `offset`, `type`, `from`, `to`

**Response** `[ { "id", "schedule_id", "report_type", "status", "created_at", "image_url", "send_count", "error" } ]`

---

### GET /api/report-history/stats
**Admin/Auditor**

**Query params** `window`: `30d` (default) | `90d`

**Response** `{ "total", "success", "failed", "types": { "daily": N, ... } }`

---

### GET /api/report-history/:id/image
**Admin/Auditor** — download the PNG for a specific history entry.

**Response** PNG binary

---

### GET /api/reports/pdf
**Any auth** — export a date-range analytics report as A4 PDF.

**Query params** `from`, `to`, `cameras`, `category_id`, `lang` (`th` | `en`)

**Response** PDF binary (`Content-Type: application/pdf`)

---

### GET /api/reports/daily
**Any auth** — daily summary stats (used by scheduled report renderer).

**Query params** `date` (YYYY-MM-DD), `cameras`

---

### GET /api/reports/weekly
**Any auth** — weekly summary stats.

**Query params** `week_start` (YYYY-MM-DD Monday), `cameras`

---

## 14. System Health Report

### GET /api/health/report/preview
**Any auth** — render Health Report as 720px PNG inline.

**Query params** `range_hours` (default 24), `sections` (CSV: `cameras,alerts,storage,system`)

**Response** PNG binary

---

### GET /api/health/report/pdf
**Any auth** — Health Report as A4 PDF.

**Query params** `range_hours`, `sections`, `lang` (`th` | `en`)

**Response** PDF binary

---

### POST /api/health/report/send-now
**Admin** — send Health Report to LINE recipients immediately.

**Body** `{ "range_hours": 24, "sections": ["cameras","storage"], "recipient_ids": ["U..."] }`

**Response** `{ "ok": true, "sent_to": 3 }`

---

> `GET /api/health/report-data/cameras` and `GET /api/health/report-data/alerts`
> are internal endpoints called by `report-renderer.js` using `X-Internal-Token`.
> Not intended for external callers.

---

## 15. Settings

### GET /api/settings
**Any auth** — all system settings as a key→value map.

**Response**
```json
{
  "data_retention_days":        { "value": "365", "description": "...", "updated_at": "..." },
  "snapshot_retention_days":    { "value": "30", ... },
  "clip_retention_days":        { "value": "30", ... },
  "appearances_retention_days": { "value": "30", ... },
  "display_timezone":           { "value": "Asia/Bangkok", ... },
  "counter_dedup_mode":         { "value": "state", ... },
  "comparison_mode":            { "value": "rolling", ... },
  "custom_range_max_days":      { "value": "365", ... },
  "analytics_event_display":    { "value": "ImageTooBright,...", ... },
  "brand_name":                 { "value": "Vigil Platform", ... },
  "brand_tagline":              { "value": "CCTV Analytics Suite", ... },
  "brand_logo_path":            { "value": "", ... },
  "brand_primary_color":        { "value": "#5b8def", ... }
}
```

---

### PUT /api/settings/:key
**Admin** — update a single setting. Unknown key → 404.

**Body** `{ "value": "730" }`

**Validated keys and allowed values**

| Key | Validation |
|---|---|
| `data_retention_days` | 1–730 |
| `snapshot_retention_days` | 1–365 |
| `clip_retention_days` | 1–90 |
| `appearances_retention_days` | 1–730 |
| `custom_range_max_days` | 1–730 |
| `display_timezone` | Valid IANA timezone string |
| `counter_dedup_mode` | `state` \| `object_window` \| `none` |
| `comparison_mode` | `rolling` \| `calendar` |
| `analytics_event_display` | CSV of known analytics event keys |
| `brand_name` | 1–100 chars |
| `brand_tagline` | max 200 chars |
| `brand_logo_path` | Simple filename `[A-Za-z0-9._-]+` or empty |
| `brand_primary_color` | `#RRGGBB` hex |

**Response** `{ "success": true, "key": "...", "value": "..." }`

---

### PUT /api/settings/map
**Admin** — update Mapbox token.

**Body** `{ "mapboxToken": "pk...." }` (must start with `pk.`; omit or empty to clear)

**Response** `{ "success": true }`

---

## 16. Branding

### GET /api/branding
**Public** — brand display values for login page and reports.

**Response**
```json
{
  "name": "Vigil Platform",
  "tagline": "CCTV Analytics Suite",
  "logo_url": "/branding/logo.png",
  "primary_color": "#5b8def"
}
```

---

### POST /api/branding/logo
**Admin** — upload a new logo. Accepts `multipart/form-data` with field `logo`.

Supported types: PNG, JPG, WebP, SVG (max 5MB). Non-SVG images are auto-resized to 256×256 PNG.

**Response** `{ "success": true, "logo_path": "logo.png", "logo_url": "/branding/logo.png" }`

---

### DELETE /api/branding/logo
**Admin** — remove the current logo (reverts to default SVG placeholder).

**Response** `{ "success": true }`

---

## 17. Map

### GET /api/config
**Any auth** — map configuration flags.

**Response** `{ "mapboxAvailable": true }`

---

### GET /api/map/areas
**Any auth** — defined map overlay areas (drawn polygons).

---

### DELETE /api/map/areas/:areaId
**Admin**

---

### POST /api/map/estimate
**Admin** — estimate tile download size before starting a download.

**Body** `{ "bbox": [minLon, minLat, maxLon, maxLat], "minZoom": 12, "maxZoom": 16 }`

**Response** `{ "tile_count": 1200, "estimated_mb": 48 }`

---

### POST /api/map/download
**Admin** — start offline tile download.

**Body** `{ "bbox": [...], "minZoom", "maxZoom" }`

**Response** `{ "ok": true, "job_id": "..." }`

---

### GET /api/map/progress
**Any auth** — current tile download progress.

**Response** `{ "status": "running" | "idle" | "done" | "error", "downloaded": 800, "total": 1200 }`

---

### POST /api/map/cancel
**Admin** — cancel an in-progress tile download.

---

### DELETE /api/map/cache
**Admin** — clear downloaded offline tile cache.

---

### GET /api/map/tiles/mapbox/:style/:z/:x/:y.png
**Any auth** — Mapbox tile proxy. Injects the server-side Mapbox token; never exposes the raw token to the browser.

---

### GET /tiles/:provider/:style/:z/:x/:y.png
**Any auth** — generic tile proxy (OpenLayers tileUrlFunction target).

---

## 18. License & EULA

### GET /api/license/machine-id
**Admin/Auditor** — hardware fingerprint used to generate a license JWT.

**Response** `{ "machine_id": "..." }`

---

### GET /api/license/status
**Any auth** — current license state. Cached for 60 seconds.

**Response**
```json
{
  "status": "ACTIVE",
  "tier": "professional",
  "camera_limit": 50,
  "expires_at": "2027-01-01T00:00:00.000Z",
  "days_remaining": 207,
  "trial": false
}
```

`status`: `ACTIVE` | `WARN_30D` | `WARN_7D` | `GRACE` | `EXPIRED` | `TRIAL_EXPIRED` | `INVALID`

---

### POST /api/license/activate
**Admin**

**Body** `{ "license_key": "<JWT>" }`

**Response** `{ "success": true, "status": "ACTIVE" }`

---

### POST /api/license/deactivate
**Admin** — remove the stored license key.

**Response** `{ "success": true }`

---

### GET /api/eula
**Any auth** — current EULA text.

**Response** `{ "text": "...", "version": "1.0", "updated_at": "..." }`

---

### GET /api/eula/status
**Any auth** — whether the current user has accepted the EULA.

**Response** `{ "accepted": true, "accepted_at": "..." }`

---

### POST /api/eula/accept
**Any auth** — record EULA acceptance for the current user.

**Response** `{ "success": true }`

---

## 19. Health & Services

### GET /api/health/details
**Admin/Auditor** — full system health snapshot.

**Response sections**

| Section | Key contents |
|---|---|
| `database` | Postgres latency, total events, 1h/24h event rate |
| `mqtt` | Last event timestamp, age (s), status (`healthy`/`idle`/`stale`) |
| `cameras` | online/offline/paused counts |
| `services` | PM2 worker list: name, status, uptime, restart count |
| `imageQuality` | Per-camera 24h auto-analytics counts |
| `automationTriggers` | Per-camera Digital Input + Relay counts |
| `storage` | Snapshot/clip file counts + sizes, disk free/total, retention config |
| `apiServer` | Process uptime, Node version, PID, RSS, heap, WebSocket clients |
| `host` | Hostname, platform, RAM total/free/used%, load average |

---

### POST /api/services/:name/:action
**Admin** — control a PM2 worker.

**Path params**
- `name`: `api-server` | `mqtt-subscriber` | `media-recorder` | `hikvision` | `dahua`
- `action`: `restart` | `stop` | `start`

> `stop` and `start` are blocked for `api-server` (returns `400 api_server_stop_start_disallowed`).
> `alert-worker` and `report-worker` are NOT in this set — managed only via `pm2` directly.

**Response** `{ "ok": true, "action": "restart", "service": "hikvision" }`
For `api-server` restart: also `"expect_reconnect": true` (process replaces itself).

---

## 20. Backups

### GET /api/backups
**Admin/Auditor** — list available backup files.

**Response** `[ { "filename": "vigil_backup_20260607.tar.gz", "size_bytes": 12345678, "created_at": "..." } ]`

---

### POST /api/backups/run
**Admin** — trigger a backup now (async).

**Response** `{ "ok": true }`

---

### GET /api/backups/:filename
**Admin** — download a backup file.

**Response** `application/gzip` binary

---

## 21. Media & Snapshots

### GET /snapshots/:filename
**Any auth** — serve an auth-gated snapshot image.

**Response** JPEG/PNG binary or 404

---

### GET /media/:filename
**Any auth** — serve an auth-gated video clip.

**Response** MP4 binary (supports `Range` requests for video seeking) or 404

---

### GET /api/snapshot/live/:cameraId
**Any auth** — live JPEG snapshot from a connected camera.

Fetches a fresh frame from the camera at request time. Uses Digest auth for Hikvision; Basic auth for Dahua; RTSP snapshot for Bosch.

**Response** JPEG binary or `502` if camera unreachable

---

## 22. Audit Log

### GET /api/audit-log
**Admin/Auditor**

**Query params**
- `limit` (default 200, max 1000)
- `userId` — filter by user ID
- `action` — filter by action string (e.g. `camera_add`, `camera_delete`, `login`, `service_restart`)
- `targetCameraId` — filter to events affecting a specific camera

**Response**
```json
[ {
  "id", "user_id", "username",
  "action": "camera_add",
  "ip_address", "user_agent",
  "details": { "camera_id": "...", "camera_name": "..." },
  "target_camera_id": "BOSCH_CAM_01",
  "created_at"
} ]
```

**Common action values**

| Action | Trigger |
|---|---|
| `login` / `logout` | Auth |
| `camera_add` / `camera_edit` / `camera_delete` | Camera CRUD |
| `camera_pause` / `camera_resume` | Maintenance toggle |
| `group_create` / `group_update` / `group_delete` | Group CRUD |
| `camera_group_assign` / `camera_group_remove` | Group membership |
| `offline_alert_update` | Camera offline alert config |
| `service_restart` / `service_stop` / `service_start` | PM2 control |
| `line_recipient_approve` / `_ignore` / `_block` / `_unblock` | Recipient onboarding |
| `map_settings_token_update` | Mapbox token change |
| `license_activate` / `license_deactivate` | License management |

---

## Error Responses

All error responses follow this shape:

```json
{ "error": "human-readable message" }
```

Standard HTTP status codes:

| Status | Meaning |
|---|---|
| 400 | Bad request — missing or invalid field |
| 401 | Not authenticated |
| 403 | Forbidden — role insufficient or auditor write attempt |
| 404 | Resource not found |
| 409 | Conflict — duplicate name, duplicate IP warning, etc. |
| 429 | Rate limit exceeded (login: 10/min per IP; CSP report: 20/min per IP) |
| 503 | Report worker unavailable |
| 500 | Internal server error |

---

## WebSocket

Connect to `ws://localhost:3000` (or `wss://` via Cloudflare Tunnel).

Authentication: send `{ "type": "auth", "token": "<session-token>" }` immediately after connection, or include `?token=<token>` in the URL.

**Server → client messages**

| `type` | Payload | Trigger |
|---|---|---|
| `new_event` | Full event row | New camera event via `pg_notify('new_event')` |
| `camera_status` | `{ camera_id, status: 'online'|'offline'|'paused' }` | Heartbeat state change |
| `alert_fired` | Alert log entry | LINE alert sent |

---

<sub>**REF_api-reference.md** v1.5.3 · 126 routes across 22 groups · Vigil Platform · Updated 2026-06-08</sub>
