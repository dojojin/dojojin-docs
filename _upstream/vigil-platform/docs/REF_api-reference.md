# REF_api-reference.md — Vigil Platform API Reference

> REST API reference for the **api-server process** (Express 5, port 3000).
>
> **Base URL:** `http://localhost:3000` (or `https://dashboard.dojojin.tech` via Cloudflare Tunnel)
>
> **สิ่งที่นับ / ไม่นับ** (เขียนไว้ตรงนี้เพราะตัวเลขเคยเพี้ยนกัน 3 ค่า — 126 / 135 / 294):
> นับ = ทุก route ที่ลงทะเบียนใน process ของ api-server รวม `/snapshots`, `/media`,
> `/lpr/:token`, `/face-push/:token` ที่ไม่มี prefix `/api` ·
> **ไม่นับ** = `src/lpr-receiver.js` (คนละ service คนละพอร์ต) ·
> `/v1/*` (Partner API) ลงสารบัญไว้แต่รายละเอียดอยู่ใน `docs/REF_third-party-integration.md`
>
> หมวด 1–24 คือคำอธิบายแบบละเอียด (request/response) — ยังไม่ครบทุก route ·
> **[ภาคผนวก A](#ภาคผนวก-a--สารบัญ-route-ทั้งหมด)** คือสารบัญ **ครบทุกตัว**
> สร้างจากโค้ดจริงด้วย `scripts/check-api-reference.js`
>
> **Slow-request log:** every request slower than `SLOW_REQ_LOG_MS` (env, default 2000) writes one
> `[slow-req] <status> <ms> <method> <url> user=… ip=…` line (`api-server.js:243-258`) with
> `token=`/`sig=` redacted. Log-only — it never throws and never touches control flow.
>
> Last updated: 2026-09-06 · v1.5.4

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

### สายของ middleware ที่ request ต้องผ่านจริง (สำคัญกว่าที่คิด)

สิทธิ์ของ route หนึ่งๆ **ไม่ได้อยู่ที่ตัว route อย่างเดียว** แต่เป็นผลรวมของ 3 ชั้นตามลำดับนี้
(`src/api-server.js`) — อ่าน guard ที่ route แล้วสรุปอย่างเดียวจะได้คำตอบผิด:

| ชั้น | ทำอะไร | ผลเมื่อไม่ผ่าน |
|---|---|---|
| 1. `app.use('/api', …)` | ยืนยัน session แล้วเติม `req.user` พร้อม `allowedSites` / `allowedCameras` | `401` |
| 2. `viewGuard` (decision #251) | allowlist ระดับหน้า/แท็บ — ใช้กับ user ที่มี `allowed_views` เท่านั้น ที่เหลือผ่านทันที | `403 VIEW_NOT_ALLOWED` |
| 3. `requireAdminForWrites(prefix)` | กัน **เฉพาะ non-GET** บน 13 prefix: `/api/cameras` `/api/groups` `/api/alert-rules` `/api/line-config` `/api/map` `/api/categories` `/api/category-rules` `/api/settings` `/api/report-schedules` `/api/license` `/api/alert-logs` `/api/blacklist` `/api/face-blacklist` | `403` |

**ข้อยกเว้นที่ต้องรู้ — 3 กลุ่ม route ที่ mount *เหนือ* ชั้นที่ 1** จึงไม่ได้ผ่าน middleware กลางเลย
และต้องมี guard ของตัวเอง: `routes/auth.js` · `routes/users.js` · `routes/partner-api.js`
(เหตุผล: user management ต้องใช้ได้แม้ตอน license write-block ทำงาน · partner ไม่มี session)
`/api/auth/sessions` และ `/api/audit-log` ในกลุ่มนี้จึงมี `viewGuard` แปะไว้เป็นรายตัว

**ทางออกที่ไม่ได้ขึ้นต้นด้วย `/api`** (`/snapshots`, `/media`, WebSocket) ไม่ผ่านชั้นไหนเลย —
ต้องเช็คเองในตัว handler ทุกอย่าง (site scope + view scope) ดู GOTCHAS #163

**สิทธิ์ 2 แกนที่คูณกัน** (decision #249/#253): *เห็นหน้าไหน* (`users.allowed_views`) ×
*ข้อมูลของใคร* (`user_sites` + `user_cameras`) · `NULL` = ไม่จำกัด · `[]` = ไม่เห็นอะไรเลย

---

## Table of Contents

1. [Auth](#1-auth)
2. [Users](#2-users)
3. [Cameras](#3-cameras)
4. [Camera Groups](#4-camera-groups)
5. [Events](#5-events)
6. [Appearances (Person Attributes)](#6-appearances-person-attributes)
7. [Face Capture](#7-face-capture)
7.5. [License Plates (LPR)](#75-license-plates-lpr)
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
23. [HCP · HikCentral (HKT เท่านั้น)](#23-hcp--hikcentral-hkt-เท่านั้น)
24. [Traffic Enforcement](#24-traffic-enforcement)
25. [Per-user View Authorization](#25-per-user-view-authorization)
- [ภาคผนวก A — สารบัญ route ทั้งหมด](#ภาคผนวก-a--สารบัญ-route-ทั้งหมด)

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
| `mqtt_broker_host` | string \| null | **Admin only**, Bosch cameras only — the site's edge-reported LAN broker host (migration 248), falling back to `MQTT_CAMERA_BROKER_HOST`. Internal LAN IP, so viewer/auditor never get this field. |

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

### POST /api/cameras/:id/push-mqtt
**Admin** — write the camera's own MQTT broker/username/password via Bosch RCP+
(`CONF_MQTT_SETTINGS`), then read it back to confirm. Central-reachable cameras
are written to directly; edge-site cameras round-trip over MQTT to that site's
edge-config-agent with an internal ~40s wait. Never returns the password.

**Response** `{ "ok": true, "before": {...}, "after": {...}, "via": "central"|"edge",
"reboot": {...}, "rebooted_at": "..." }` or `{ "ok": false, "error": "..." }`.
A `504` means no reply arrived within the wait — outcome unknown, not
necessarily failed. A successful write also reboots the camera (it keeps its
old MQTT session until reboot) — `reboot` is `{ ok, unconfirmed?, error? }`
from that reboot command, and `rebooted_at` is only set when `reboot.ok`.

---

### GET /api/cameras/:id/mqtt-seen
**Admin** — `cameras.last_mqtt_at` for this camera (set by mqtt-subscriber from
the receive time of its own MQTT messages, flushed every 60s — not a live
probe). Used by the push-mqtt UI to poll for the camera reconnecting after the
reboot that push-mqtt triggers.

**Response** `{ "last_mqtt_at": "..." }` or `404` if the camera does not exist.

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

### POST /api/cameras/lpr-forward-test
**Admin** — probe reachability of an LPR forward URL with SSRF guard.

**Body** `{ "forward_url": "http://example.com/api/lpr/push" }`

**Response** `{ "reachable": true, "status": 200, "latency_ms": 45, "error": null }` or `{ "reachable": false, "status": null, "latency_ms": null, "error": "Connection timeout" }`

---

### GET /api/cameras/status-current
**Admin/Auditor** — current operational snapshot for every camera in `cameras-config.json`,
joined with the DB row + latest event (`cameras.js:2046`).

**Response** — an **object**, not an array:
```json
{
  "summary": { "total": 169, "online": 160, "offline": 8, "paused": 1 },
  "cameras": [
    { "camera_id", "camera_name", "vendor", "status",
      "created_at", "updated_at", "last_seen_at", "last_event_at", "offline_for_sec" }
  ]
}
```
- `offline_for_sec` is `null` unless `status === 'offline'`
- config with zero cameras → `{ summary: { total: 0, online: 0, offline: 0 }, cameras: [] }`
  (that early-return omits `paused` — `cameras.js:2051`)
- reads `events` directly (not `event_dim_bucket`) because the view needs second-level
  accuracy; per-camera `LATERAL … ORDER BY event_time DESC LIMIT 1` since 2026-09-05

---

### GET /api/cameras/status-log
**Any auth** — online↔offline transition history (90-day retention).

**Query params**
- `cameraId` — filter by camera
- `limit` (default 100)

**Response** `[ { "id", "camera_id", "status", "reason", "changed_at" } ]`

---

### GET /api/cameras/image-quality-log
**Admin/Auditor** — paginated diagnostics history for the four image-quality signals
(`ImageTooBright`, `ImageTooBlurry`, `ImageTooDark`, `GlobalSceneChange`) — `cameras.js:2176`.

**Window: last 30 days only** (`IQ_WINDOW_DAYS`, 2026-09-05). Older rows no longer appear —
a deliberate behaviour change traded for the endpoint no longer timing out.

**Query params**

| Param | Type | Notes |
|---|---|---|
| `camera_id` | string | Filter to one camera |
| `type` | string | One of the four types above; anything else is ignored |
| `limit` | int | Default 50, max 200 |
| `offset` | int | Default 0 |

**Response headers**
- `X-Total-Count` — from `event_dim_bucket` (rollup), so it **lags real rows by ≤ ~5 min**
  and can stay permanently slightly low for events that arrived >3 h late. The last page may
  therefore contain more rows than the header advertises.

**Response** `[ { "id", "camera_id", "event_type", "event_state", "event_time" } ]`
(no candidate type in the window → `[]` without touching `events` at all)

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

- `limit` 1–2000 (ค่าเริ่มต้น 100, ไม่ใช่ตัวเลข = 100) · `offset` ≥ 0 (2026-10-02)

**Response headers**
- `X-Total-Count` — total matching rows (before LIMIT/OFFSET), **capped** — see below
- `X-Total-Capped` — `1` when the count hit the cap (decision #264)

> **Counting is capped at `EVENTS_COUNT_CAP` (env, default 10000)** — `events.js:48/336-363`.
> The count query runs inside `SELECT count(*) FROM (… LIMIT cap) t`, so `X-Total-Count` is a
> **floor**, not the true total, once it reaches the cap. The UI renders `"10,000+"` in that case
> instead of a wrong exact number. Both headers are in the CORS `exposedHeaders` allowlist
> (`api-server.js:143`). `/api/appearances` sets `X-Total-Capped` on the same principle
> (`appearances.js:479`).

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

- เพดานเวลาต่อคิวรี `FACETS_QUERY_TIMEOUT_MS` (8 วิ) มีผลจริงตั้งแต่ 2026-10-02 (เดิม SET LOCAL อยู่นอก transaction) · `vehicle_types` มาจาก `event_dim_bucket`

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
**Any auth** — appearance attributes for a specific event, matched by exact `event_id` (no time-window fallback). Used by the Events modal, the Face Recognition match modal, and the HCP face-search result modal (`dashboard/page-face-matches.js`, `dashboard/page-hcp-face-search.js`) — reuse `_buildAppChips()`/`_renderAppearanceSection()` from `dashboard/page-snapshots.js` rather than re-fetching/re-rendering this by hand (decision #241).

**Response** `{ "id", "event_id", "gender", "age", "clothing_upper_color", ... }` or 404

---

## 6. Appearances (Person Attributes)

### GET /api/appearances/stats
**Any auth** — aggregate appearance statistics.

**Query params** `from` (บังคับ), `to`, `camera_id`, `site_id`, `object_class`

- ช่วง `from`→`to` (ไม่ส่ง `to` = ตอนนี้) เกิน 2 วัน หรือไม่ส่ง `from` → `400 {"error":"range_too_large","max_days":2}` ทันที ไม่แตะ DB (2026-10-02 · GOTCHAS #217)

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

## 7.5. License Plates (LPR)

> ITC/ANPR camera detections — license plate reads from Hikvision IDS-2CD9396-HIS and integrated LPR sensors.

> **สิทธิ์เขียน (2026-10-02 · GOTCHAS #217):** ทุก method ที่ไม่ใช่ GET ใต้ `/api/lpr/*` ต้องเป็น admin → ไม่ใช่ = `403 {"error":"Admin role required for this operation"}` ยกเว้นงานของเจ้าหน้าที่: `POST /alerts/:id/(ack|notify|notify-telegram)` · `POST /gs-alarms/:id/(notify|notify-telegram)` · `POST|DELETE /watchlist/:plate/mute` (`src/helpers/lprWriteGuard.js`)

### GET /api/lpr
**Any auth** — paginated license plate detection list. Keyset-paginated (decision #211) for cursor-based navigation.

- `q` แบบบางส่วน (ไม่ส่ง `exact=1`) สั้นกว่า 3 ตัวอักษร (ไม่นับช่องว่าง) → `400 {"error":"query_too_short","min":3}` (2026-10-02 · ดัชนี trigram ใช้ไม่ได้ <3 ตัว)
- `q` + `match=pattern` (2026-10-22) — ค้นตามรูปแบบที่เทียบ **ทั้งป้าย**: `#` ตัวเลข · `@` อักษรไทย ก–ฮ · `?` อะไรก็ได้ 1 ตัว · `*` อะไรก็ได้ กี่ตัวก็ได้ · `[5-9]` / `[กขค]` ตัวเดียวจากชุดหรือช่วง · ตัวอื่นตรงตัว (เว้นวรรคถูกตัด) · แปลงเป็น `plate_number ~ $n` ใน `src/helpers/platePattern.js` (ส่งเป็น parameter) · ต้องมี `from` และช่วง ≤ 7 วัน ไม่งั้น `400 {"error":"pattern_range_too_wide","max_days":7}` · รูปแบบผิด → `400 {"error":"bad_pattern","reason":"…"}` · ใช้ index ไม่ได้ (วัด: 1 วัน ~0.1 วิ · 7 วัน ~0.4–1.1 วิ) · ตัวอย่าง `[5-9]#*` = หลักแรก 5–9 หลักสองเป็นเลข ที่เหลือไม่สน

**Query params**

| Param | Type | Notes |
|---|---|---|
| `before_time` | ISO timestamp | Keyset cursor: latest `event_time` to exclude (for cursor-based pagination) |
| `before_id` | bigint | Tie-breaker: largest `id` to exclude when times equal |
| `count` | string | Pass `count=est` to request estimated row count in response header |
| `from` | ISO timestamp | Inclusive lower bound on `event_time` |
| `to` | ISO timestamp | Inclusive upper bound on `event_time` |
| `cameras` | CSV | Camera IDs: `CAM1,CAM2` |
| `belt` | `no` | Filter to detections with missing seatbelts (`no_seatbelt=true`) |
| `vehicle_brands` | CSV | Vehicle brand codes: `BYD,TESLA` |
| `vehicle_colors` | CSV | Vehicle body colors: `black,white,red` |
| `plate_colors` | CSV | License plate colors: `yellow,white,blue` |
| `lanes` | CSV | Lane numbers: `1,2,3` |
| `limit` | int | Default 100 |

**Response headers**

| Header | Notes |
|---|---|
| `X-Has-More` | `1` if more rows exist beyond this batch, `0` otherwise |
| `X-Estimated-Count` | Total matching row estimate (only present when `count=est` was passed); used by UI planner |

**Response array** — `license_plates` table row plus computed fields

```json
[
  {
    "id", "event_time", "camera_id",
    "plate_text", "plate_color", "confidence",
    "vehicle_brand", "vehicle_color", "vehicle_type",
    "no_seatbelt", "lane", "direction",
    "snapshot_file", "clip_file", "clip_status"
  }
]
```

---

### GET /api/lpr/brands
**Any auth** — distinct vehicle brands detected with counts.

Source is the **`lpr_dim_daily` rollup** (`dim = 'vehicle_brand'`), not `license_plates`
(`lpr-query.js:477-489`). In-process cache keyed by the caller's site scope,
**TTL 30 minutes** (`BRAND_TTL_MS`); at most 8 scope entries are kept.
No `X-Cache` header on this one — the cache is silent.

**Response** `[ { "brand": "BYD", "n": 142 }, { "brand": "TESLA", "n": 89 }, ... ]`

---

### GET /api/lpr/no-read
**Any auth** — ANPR events where the camera fired but read **no plate**
(the "ไม่ทราบทะเบียน" tab) — `lpr-query.js:568`.

**Definition (since migration 199, 2026-09-06):** the predicate
`COALESCE(e.raw_json->>'plate','') = ''` on `event_type = 'anprAlarm'` — it replaced the old
`NOT EXISTS (license_plates)` anti-join, which measured identical both ways (24 h 19,637 =
19,637 · 7 d 156,201 = 156,201, zero rows differing in either direction) but could not be indexed.

> ⚠️ **The predicate text is load-bearing.** Postgres matches a partial index by expression
> tree, so it must stay byte-identical (only the `e.` alias may differ) across
> `db/db_migration_199_events_anpr_noread_index.sql`,
> `scripts/create-face-blacklist-index.js` → `INDEXES.anpr_noread.pred`, and this route.
> Backing index: `idx_events_anpr_noread_time ON events (event_time DESC, id DESC)
> WHERE event_type = 'anprAlarm' AND COALESCE(raw_json->>'plate','') = ''`.
> A weekly self-check (`src/helpers/noreadCheck.js`, Sun 04:30 ICT) re-counts both definitions
> and publishes the result to `/api/health/details` → `lpr.noread_check`.

**Query params**

| Param | Type | Notes |
|---|---|---|
| `from` | ISO timestamp | **Default = now − 24 h** — the window is the query's only bound |
| `to` | ISO timestamp | Optional upper bound |
| `cameras` | CSV | Multiple camera IDs |
| `limit` | int | Default 30, max 100 |
| `offset` | int | Default 0 |

**Response headers** — `X-Total-Count` (exact; this route is not capped)

**Response** — shaped like an LPR row so the tab can reuse the same renderer, with the
plate fields nulled: `[ { "id", "camera_id", "event_time", "snapshot_file",
"plate_number": null, "lp_region": null, "lp_vehicle_type", "lp_vehicle_color",
"lp_vehicle_brand", "plate_image": null, "confidence", "raw_json": {} } ]`.
Vehicle attributes are decoded from `raw_json.data.Vehicle` (Dahua). Hikvision drops
plate-less ANPR events upstream, so they never reach this tab.

---

### GET /api/lpr/stats
**Any auth** — aggregate LPR statistics. Includes new chart data.

**Query params** `period` (`hour|today|yesterday|week|month|custom`), `from`, `to`, `cameras`, `part=kpi|plates`, `noplates=1`

- **ตัวเลขระดับป้าย 4 ตัว** (`unique` · `local` ≥2 ครั้ง · `visitor` =1 ครั้ง · `mismatch`) นับ DISTINCT ทั้งช่วงสดเสมอ
  จึงเป็นส่วนที่ช้าที่สุด (custom 30 วัน ~26 วิ) — แยกขอได้ (2026-10-06):

  | แบบ | ได้อะไร | หมายเหตุ |
  |---|---|---|
  | (ไม่ระบุ) | ทุกฟิลด์ | warmer เตรียม today/week/month ให้ admin |
  | `noplates=1` | ทุกฟิลด์ **ยกเว้น** 4 ตัวข้างบน | custom 30 วัน < 1 วิ (อ่านตารางสรุป) |
  | `part=plates` | `unique` `local` `visitor` `mismatch` (+ `partial: true`) | ขอบเขตเดียวกับคำขอเต็ม |
  | `part=kpi` | `total` `noread` `vehicles` `watch` `no_helmet` `no_helmet_ok` `overload` (+ `partial: true`) | **ไม่มี 4 ตัวระดับป้าย** · `total` = ป้ายที่อ่านได้ (ไม่รวม `unknown`) ตรงกับคำขอเต็ม · ช่วงที่มีตารางสรุปคืนผลเดียวกับ `noplates=1` |

  หน้า LPR ช่วง custom ยิง `noplates=1` + `part=plates` ขนานกัน · ช่วงอื่นยิง `part=kpi` + คำขอเต็ม ·
  LINE/Telegram "ยอดอ่านป้าย" ยิง `part=kpi` + `part=plates`
- `period=custom` ที่ไม่มี `from` ถูกจำกัดที่ 31 วันล่าสุด (หรือ 31 วันก่อน `to`) — ไม่กวาดทั้งประวัติ
- คำขอที่คิดสด (`today`/`hour`/`custom`) รันทีละ 1 (kpi ทีละ 2) · คำขอเหมือนกันที่ยิงพร้อมกันรอผลก้อนเดียว
- รอคิวเกิน `LPR_STATS_QUEUE_WAIT_MS` (ค่าเริ่มต้น 45 วินาที) → `503 {"error":"busy"}` พร้อม `Retry-After: 15`
- `GET /api/stats/lpr/report` ใช้กติกาคิวเดียวกัน (ทีละ 1 · 503 busy)

**Response** extends base KPI with new fields:

```json
{
  "total": 500,
  "by_hour": [ ... ],
  "pcolor": [ { "color": "yellow", "count": 320 }, { "color": "white", "count": 180 } ],
  "brand": [ { "brand": "TOYOTA", "count": 145 }, { "brand": "HONDA", "count": 98 }, ... ]
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

### GET /api/categories/rule-discovery
**Any auth** — combos of `(camera, rule_name, event_type, object_class, vehicle_type)` actually
seen recently, so the Manage page can point at rules that are firing but not mapped into any
category (`categories.js:54`).

**Response**
```json
{ "window_days": 7, "per_camera_cap": null,
  "combos": [ { "camera_id", "site_id", "rule_name", "event_type",
                "object_class", "vehicle_type", "n", "last_seen" } ] }
```

Read from `event_dim_bucket` (rollup, migration 163) since 2026-09-05 — 90 ms, down from
14.5 s. Consequences of that change, all intentional:
- **`per_camera_cap` is now `null`** (was 2000 latest events/camera) — combos that used to fall
  off the edge on busy cameras are visible again
- `n` is the real 7-day total, not a count over a 2000-row sample → **numbers read higher than
  before; that is not a bug**
- `last_seen` = `MAX(bucket)`, 30-minute resolution, so it can be up to 30 min behind, and a
  brand-new combo appears ≤ ~5 min late (refresher cycle)

Matching a combo against existing rules is done client-side.

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

> **ช่วงเวลาบังคับเสมอ (2026-09-08):** endpoint กลุ่มนี้ (`/api/stats/kpi`, `/timeline`, `/breakdown`, `/timeseries-rules`)
> รับ `from`/`to` แบบ ISO หรือ `range=1h|1d|7d|30d` · ไม่ส่งอะไรเลย = **1 วันล่าสุด** ไม่ใช่ทั้งตารางเหมือนเดิม
> เดิมขอบเวลาผูกกับ `if (from)` ทำให้คำขอที่ไม่ส่งช่วง (เช่น `?period=today` ซึ่งไม่ใช่พารามิเตอร์ของ endpoint นี้)
> ไล่ทุก partition ของตาราง `events` — วัดได้ 35.3 วินาที ตอนนี้ 0.44 วินาที · ต้องการทั้งหมดจริง ๆ ให้ส่ง `from` ย้อนไกลเอง
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
  "deliver_via": "line",
  "telegram_chat_ids": [],
  "created_at"
} ]
```

> `active_from` / `active_to` = **quiet hours** (LINE is SILENCED during this window), not active hours.
> `deliver_via` (T2b) = `line` (default, unchanged behaviour) | `telegram` | `both` | `line_then_telegram` (reserved for T3 fallback — behaves as `line` today). `telegram_chat_ids` = chat ids from `telegram_config.chats` this rule sends to when the Telegram leg is active.

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
  "active_to": "06:00",
  "deliver_via": "line",
  "telegram_chat_ids": []
}
```
`camera_ids` / `rule_names` / `recipient_ids`: empty array = match all.
`active_from` / `active_to`: `HH:MM` format or null. Both null = no quiet hours.
`deliver_via` / `telegram_chat_ids` (T2b, both optional): validated by `helpers/deliverViaValidate.js`
(shared with `PUT /api/alert-channels/:channel`) — `telegram` is rejected with `400` unless the bot is
enabled, has a token, and at least one approved chat is selected (in this request or already saved).

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

- `integrity` (2026-10-02 · GOTCHAS #217): `future_events` · `baseline_computed_at` · `baseline_stale` (>26 ชม.) · `ws_bridge_connected` · `cameras_stuck_offline[]` (heartbeat สดแต่ offline >1 ชม.) · `disk_io_errors_24h` (kernel log, null = อ่านไม่ได้)

**Response — real top-level keys** (verified against `health.js:205-680`; earlier revisions of
this doc listed `database` / `mqtt` / `imageQuality` / `apiServer` / `host`, none of which exist):

| Key | Always present | Contents |
|---|---|---|
| `timestamp` | ✅ | ISO time the snapshot was taken |
| `server` | ✅ | Process **and** host: uptime, Node version, PID, RSS/heap MB, platform, hostname, 1/5/15-min load, host uptime, CPU count, total/free RAM MB, `spec` |
| `db` | ✅ | `ok`, `latency_ms`, `error`, `pool` (total/idle/waiting/peak), `long_transactions`, `long_running_queries` |
| `mqtt_pipeline` | ✅ | `last_event_at`, `age_sec`, `status` |
| `cameras` | ✅ | `total`, `online`, `offline` |
| `events` | ✅ | `last_hour`, `last_24h`, `total`, `face_total`, `lpr_total`, `totals_approx` — see below |
| `storage` | ✅ | Snapshot / face-crop / face-full / lpr-plate / lpr-scene / clip file counts + MB, `clips_today`, `clips_oldest_at`, `spool_files`/`spool_mb`, retention config, `disk_free_gb`/`disk_total_gb` |
| `lpr` | ✅ | `noread_check` — see below |
| `websocket` | ✅ | `{ clients }` — live WS connection count |
| `image_quality` | ✅ (may be `[]`) | Per-camera 24 h counts, read from `event_dim_bucket` (16 ms) since 2026-09-05 |
| `diagnostics_ms` | ✅ | Per-section wall-clock ms — see below |
| `automation_triggers` | ⚠️ only if its query succeeds | Per-camera Digital Input + Relay counts |
| `media_buffer` | ⚠️ only if `media-buffer/` is readable | Per-recorder rolling-buffer freshness (GOTCHAS #84) |
| `disk_health` | ⚠️ only if `sampleStorage()` succeeds | Mounts + RAID detail |
| `workers` | ✅ | `{ alert, report }` — each worker's own `/health` payload |
| `services` | ✅ | PM2 list for the 8 tracked processes: `name`, `status`, `restarts`, `uptime_ms`, `pid` (all `status: 'unknown'` if `pm2 jlist` fails) |
| `security` | ✅ | `{ plaintext_creds: [camera_id…] }` — cameras still storing unencrypted credentials |
| `edge_sites` | ✅ (may be `[]`) | Multi-site edge inventory (one entry per EDGE_SITE_ID): includes `snapshot_oldest` (ISO date of oldest snapshot dir) + `snapshot_dirs` (count of `<YYYY-MM-DD>` directories in `snapshots/events/`) |

#### `events.totals_approx` (decision #263)

`total`, `face_total` and `lpr_total` are **approximate**, and the key is set to `true` to say so
(`health.js:458`); the UI prefixes them with `≈`. `last_hour` / `last_24h` stay exact.

- `total` → `SUM(GREATEST(reltuples,0))` over every `events` partition (`pg_class` + `pg_inherits`)
- `face_total` / `lpr_total` → `SUM(n)` over the `event_dim_bucket` rollup

Reason: `events` reached 40.5 M rows after partitioning, and a cold exact `count(*)` measured
**40.5 s** — past the route's own 2 s timeout, so the scan was paid for and thrown away.
Measured drift 2026-09-06 vs exact: total 0.02 % · face 0.006 % · lpr 0.35 % (the rollup only
started 2026-06-22 and misses events arriving >3 h late). `reltuples` is `float4`, so at this
scale `total` moves in steps of ~4 and can tick *down* while the true count rises — this is
expected, and the `≈` is what communicates it. `totals_approx` is set **after** the query, not in
the default shape, so a failed query reports `0` rather than a misleading `≈0`.

#### `lpr.noread_check`

`null` until the weekly job has run once. Otherwise the parsed `lpr_noread_check` settings row:
`{ checked_at, hours, predicate, anti_join, mismatch, ok }`. **`ok` is `mismatch === 0`**, not
`predicate === anti_join` — two equal totals can still be two different row sets. `predicate === 0`
*and* `anti_join === 0` means "nothing to check", not "check passed".
Written by `src/helpers/noreadCheck.js` (Sun 04:30 ICT, ~16 s, never at boot); the endpoint only
reads one cached settings row. See `GET /api/lpr/no-read`.

#### `diagnostics_ms`

Per-section wall-clock ms for the sections that scan the filesystem, spawn a process, or run a
heavy query — so a slow Health page names its culprit instead of "the endpoint is slow somehow"
(OPT5-CEN-001). Keys: `longRunningQueries`, `event_counts`, `image_quality`,
`automation_triggers`, `snapshot_stats`, `clips_dir`, `storage_health`, `spool_dir`, `workers`,
`pm2`. Anything over 1000 ms also logs a `[health] section "<name>" took <n>ms` warning.

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

### GET /snapshots/*path
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

### GET /dashboard.bundle.js
**Any auth** — every dashboard script concatenated into one file (`api-server.js:630-693`).
Built once at boot from the `<script src>` tags in `dashboard/index.html`; `404` when the build
was skipped or failed. Not in `PUBLIC_HTML_FILES`, so it sits behind the session gate like any
other dashboard script.

**Caching** — the shell rewrites the tag to `/dashboard.bundle.js?v=<sha1-12>`:

| Request | `Cache-Control` |
|---|---|
| with `?v=` | `private, max-age=31536000, immutable` |
| without `?v=` | `no-cache` |

`ETag` is the same 12-hex content hash either way. Because the version is part of the URL, a
deploy changes the URL and the immutable entry is simply never asked for again — which is what
lets it be cached for a year without a stale-JS incident.

**Failure modes to know** (decision #268)
- One member file with a syntax error breaks every script after it, so the build refuses to ship
  a bundle that does not parse (`vm.Script` check) and falls back to unbundled scripts
- 11 members run **sloppy** inside the bundle: the leading `;` ends the directive prologue, so a
  member's own `'use strict'` degrades to a no-op. strict→sloppy only loosens, so working code
  keeps working
- Kill switch: `DASHBOARD_BUNDLE=0` (also skips the build entirely)

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

## 23. HCP · HikCentral (HKT เท่านั้น)

> **ขอบเขต:** เราต่อ HCP ผ่าน **edge ภูเก็ต** เท่านั้น (central ไปไม่ถึง `10.0.10.9`)
> ทุกเส้นทางในกลุ่มนี้ hardcode `site_id = 'hkt'` — ไซต์อื่นไม่เกี่ยวและเรียกไม่ได้

### POST /api/hcp/face-search
**Admin**

ค้นใบหน้าย้อนหลังด้วยรูป โดยใช้ HCP เป็นเครื่องค้น แล้วต่อผลเข้ากับ `events` ของเราเอง
(กล้องเดียวกัน + เวลาใกล้กัน) · เขียนแถว `audit_log` action `hcp_face_search` (เก็บ
**sha256 ของรูป** ไม่ใช่ตัวรูป) **ก่อน** ยิงข้าม tunnel — การค้นที่ล้มกลางทางก็คือการค้นที่เกิดขึ้นแล้ว

**Body**
- `pictureData` — base64 (รับ `data:image/...;base64,` นำหน้าได้)
- `since` / `until` — ISO-8601 · **ช่วงต้องไม่เกิน 31 วัน** และ `until` ต้องหลัง `since`
- `cameras` (optional) — `camera_id` ของเรา · ไม่ระบุ = ทุกตัวที่แมปไว้
- `threshold` (0-1, default 0.7) · `maxResults` (default 100) · `targetIndex` (รูปมีหลายหน้า)
- `joinMinutes` (1-60, default 5) — หน้าต่างจับคู่กับเหตุการณ์ของเรา

**Response**
```json
{ "ok": true, "faces_in_picture": 1,
  "searched": { "cameras": 83, "windows": 5, "calls": 5, "failed_calls": 0 },
  "join_minutes": 5, "matched_ours": 2,
  "results": [ { "similarity": 0.83, "capture_time", "hcp_index", "camera_id",
                 "gender", "age_group", "mask", "glasses",
                 "ours": { "id", "event_time", "event_type", "snapshot" } } ] }
```

**เพดาน (ปฏิเสธพร้อมตัวเลข ไม่ตัดเงียบ — `src/helpers/hcpSearchPlan.js`)**

| เงื่อนไข | ผล |
|---|---|
| ช่วง > 31 วัน | `400 { error, requested_days, limit_days }` |
| `until` ≤ `since` หรือวันที่แปลงไม่ได้ | `400 { error, since, until }` |
| คำขอถึง HCP รวม > 40 | `400 { error, windows, camera_batches, total_calls, limit_calls }` (จาก edge) |
| ไซต์ไม่มี Intelligent Fusion Server | `409` |
| ไม่พบใบหน้าในรูปที่ส่งมา | `422 { error, faces: 0 }` |
| edge/HCP ล้ม | `502` |

### GET /api/hcp/cameras
**Admin**

กล้อง hkt ที่แมปกับ HCP แล้ว พร้อมผลเทียบกับ **ไฟล์แมปบน edge**
(`src/hcp-camera-map.json` — ก๊อปมือ, gitignored, ดริฟต์ได้เงียบ ๆ)

```json
{ "cameras": [ { "hcp_index", "camera_id", "hcp_name", "name" } ],
  "drift": { "in_sync": false, "db_count": 83, "edge_count": 82,
             "missing_on_edge": ["..."], "extra_on_edge": [],
             "changed": [ { "hcp_index", "db", "edge" } ] } }
```
`drift.error` = เทียบไม่ได้ (edge ต่อไม่ติด / ยังไม่มีไฟล์) — **ไม่ใช่** แปลว่าตรงกัน

### GET /api/hcp/devices
**Admin** · HC4 — อุปกรณ์ทุกชนิดที่ HCP ภูเก็ตดูแล พร้อมบอกว่าตัวไหนเราดูแลอยู่ด้วย

```json
{ "summary": { "cameras": {"total":756,"online":687,"offline":69,"unknown":0},
               "encodeDevices": {...}, "recordServers": {...}, "intelligentServers": {...},
               "alarmInputs": {...}, "alarmOutputs": {...} },
  "vms": { "ip", "port", "cpu", "status" },
  "cameras": [ { "index_code", "name", "status", "encode_dev", "ours": { "camera_id", "name" } } ],
  "coverage": { "hcp_total": 756, "ours": 83, "hcp_only": 673, "mapped_missing_in_hcp": 0 } }
```
`status` ของ HCP ทุกชนิดใช้เลขชุดเดียวกัน: `0` ไม่ทราบ · `1` ออนไลน์ · `2` ออฟไลน์

### GET /api/hcp/events
**Admin** · HC5 — เหตุการณ์ของ HCP **ยกเว้น** ป้ายทะเบียน (130/131) และใบหน้า (49697)
ซึ่งมีทางเดินของตัวเองอยู่แล้ว

**Query:** `since` · `until` (≤31 วัน เพดานเดียวกับ face-search) · `types` (คั่นด้วย `,`) · `limit` (≤1000)

```json
{ "scope": { "cameras": 756, "batches": 4, "calls": 4, "failed_calls": 0,
             "types": 298, "excluded": ["130","131","49697"], "since", "until" },
  "by_type": { "196638": 2 }, "total": 2, "ours": 1,
  "rows": [ { "event_id", "type", "src_index", "src_type", "start_time", "stop_time",
              "description", "pic_uri", "camera_id" } ] }
```
`camera_id` เป็น `null` = กล้องที่ HCP ดูแลอยู่ตัวเดียว (เราไม่ได้แมป) — คือเหตุผลที่หน้านี้มีอยู่

**Cache** — ตอบกลับถูก cache ในโปรเซส **30 วินาที** (`HCP_EVENTS_TTL_MS`, `hcp.js:480`)
คีย์ = query string + `scopeCacheKey(allowedSites)` (decision #266) · แจ้งสถานะผ่าน header
`X-Cache`

| ค่า | ความหมาย |
|---|---|
| `HIT` | ตอบจาก cache ที่ยังไม่หมดอายุ |
| `MISS` | ยิงไป HCP จริงแล้วเก็บผลใหม่ |
| `STALE` | HCP ล้ม (ยกเว้น `400`/`409`) แต่มีของเก่าอยู่ → คืนของเก่าแทน error |

**Edge endpoints (bearer `SNAPSHOT_PROXY_SECRET`, ไม่ใช่ session)** — `src/lpr-receiver.js` บน edge hkt

| Endpoint | ใช้ทำอะไร |
|---|---|
| `POST /hcp-face-search` | ตัวที่คุยกับ HCP จริง (central proxy มาให้) |
| `GET /hcp-camera-map` | คืน `{ file, count, map }` ให้ central เอาไปเทียบ · ไม่มีไฟล์ = `404` |
| `GET /hcp-devices` | HC4 — ยอดรวมอุปกรณ์ทุกชนิด + รายการกล้อง/เครื่องบันทึก |
| `POST /hcp-events` | HC5 — เหตุการณ์ตามช่วงเวลา (แบ่งก้อนกล้องให้เอง) |
| `POST /blacklist-source-fetch` `{source:'hcp'}` | HC3 — คลังใบหน้า 17 กลุ่ม / รถ 3 กลุ่ม (ข้าม Whitelist·VIP) |
| `GET /hcp-optional` · `POST /hcp-optional` | HC-R — ดู/เรียกความสามารถที่ปิดสวิตช์ไว้ · `403` เมื่อยังปิด |

**HC-R — สวิตช์ที่ยังปิดอยู่** (`HCP_OPTIONAL` ใน `.env` ของ edge, ค่าปริยาย = ปิดหมด)

| cap | ได้อะไร |
|---|---|
| `lpr_all` | ป้ายทะเบียนทั้งหมดจาก HCP — **ทีละกล้อง** ต้องส่ง `camera` |
| `events_all` | เหตุการณ์ **รวม** หมวดที่ HC5 ตัดออก |
| `subscription_view` | ดู push subscription ที่มีอยู่ (อ่านอย่างเดียว — การ subscribe จริงจงใจไม่เขียน) |
| `video_url` | ลิงก์วิดีโอสด/ย้อนหลังของกล้องหนึ่งตัว |
| `regions` · `persons` | พื้นที่ 38 · ทะเบียนบุคคลของ HCP |


---

## 24. Traffic Enforcement

### GET /api/traffic/enforcement
**Auth required (any role)**

ข้อมูลทั้งหน้า Traffic Enforcement ในคำขอเดียว (ชั่วโมง×วันในสัปดาห์, รายกล้อง, รายชนิดรถ,
อนุกรมรายวันสำหรับแท็บก่อน-หลัง) — อ่านจากตาราง pre-aggregate `traffic_hourly_stats`
(migration 142, รีเฟรชทุก 15 นาทีโดย `src/traffic-stats-refresher.js`) ไม่ query
`license_plates` (12.6M แถว) ตรงๆ ต่อ request

**Query params**
- `days` — `7` / `28` / `90` เท่านั้น (ค่าอื่นตกกลับเป็น `28`)
- `cameras` (optional) — `camera_id` คั่นด้วย comma (สูงสุด 200 ตัว) — ไม่ระบุ = ทุกกล้อง

**Response**
```json
{ "ok": true, "days": 28, "generated_at": "...",
  "hourly": [ { "dow": 1-7, "hour": 0-23, "days_seen", "moto", "no_helmet", "riders3", "car", "no_seatbelt" } ],
  "cameras": [ { "id", "name", "site_code", "site_name", "site_color",
                 "moto", "car", "no_helmet", "no_seatbelt", "riders3",
                 "helmet_pct", "belt_pct", "night_ratio", "detect" } ],
  "vehicle_types": [ { "type", "n" } ],
  "belt_by_type": [ { "type", "total", "bad", "pct" } ],
  "sites": [ { "id", "code", "name", "color" } ],
  "daily": [ { "date": "YYYY-MM-DD", "moto", "no_helmet", "car", "no_seatbelt", "riders3", "cams" } ],
  "no_detect_min_sample": 2000 }
```

**ต้องรู้ก่อนใช้ตัวเลขนี้ (decision #237):**
- `no_helmet` มีความหมายเฉพาะ `moto` (รถ 2-3 ล้อ) — `no_seatbelt` มีความหมายเฉพาะ `car` (4 ล้อขึ้นไป) ห้ามหารด้วยรถรวมทุกชนิด
- `cameras[].detect === false` = กล้องนั้นน่าจะยังไม่เปิดตรวจจับ (รถผ่าน ≥ `no_detect_min_sample` แต่ `no_helmet` เป็น 0 ตลอด) — ไม่ใช่ compliance สมบูรณ์แบบ ต้องกันออกจากค่าเฉลี่ยรวม
- `daily[].cams` ใช้เช็คว่าสองช่วงเวลาที่จะเทียบ (ก่อน/หลังกวดขัน) มีจำนวนกล้องรายงานใกล้เคียงกันไหมก่อนสรุปผล — ต่างกัน >15% หรือมีวันที่ `moto`/`car` สูงแต่ violation เป็น 0 ถือว่าเทียบกันไม่ได้

---

## Internal endpoints (report-worker, `127.0.0.1:REPORT_WORKER_PORT`)

**Not part of the 344.** `src/report-worker.js` is a separate PM2 process with its own bare
`http` server, bound to `127.0.0.1` only (default port `3001`) — never reachable from outside the
host, never through the tunnel. It exists so Chromium lives in a process that can die without
taking api-server with it.

| Method | Path | Auth |
|---|---|---|
| `GET` | `/health` | none (loopback only) |
| `POST` | `/run/:id` | `X-Internal-Token` |
| `POST` | `/render` | `X-Internal-Token` |

`X-Internal-Token` must equal `INTERNAL_API_SECRET` (≥32 chars, compared with
`crypto.timingSafeEqual`). The worker **exits at boot** if that env var is missing or too short.
Anything else returns `404`.

### GET /health
`{ ok, worker: 'report-worker', uptime_sec, pid, memory_rss_mb, db: { ok, latency_ms, error? },
scheduler: { last_check_at } }`. Always `200`, even when the DB probe fails — `ok` carries the
verdict. Surfaced upward at `/api/health/details` → `workers.report`.

### POST /run/:id
Runs the given `report_schedules` row now. Replies `{ ok: true }` **before** the render starts;
`404` if the schedule id does not exist.

### POST /render
api-server borrows this process to render an operator-initiated download, so Chromium is never
spawned inside api-server (VMOD-03).

**Body** `{ "fn": "<name>", "args": { … } }` — `fn` must be in the allowlist, or `400 fn not
allowed`:

`renderReportPdf` · `renderReportImage` · `renderFaceReportImage` · `renderFaceReportPdf` ·
`renderLprReportImage` · `renderLprReportPdf`

> The allowlist is not decoration: the body arrives over the network (loopback or not), and
> `reportRenderer[fn]` on an unchecked string is "call any export of that module". The list is
> duplicated in `src/helpers/renderViaWorker.js` so a request known to be refused is never sent,
> and so the in-process fallback cannot be steered either.

**Body limit 2 MB**, counted while receiving (an oversized body is drained, then answered `400` —
destroying the socket would give the caller `ECONNRESET` instead of a reason).
**Response** `application/octet-stream` with the rendered bytes, or `500 { error }`.

**Callers** — 7 routes / 8 call sites in `src/routes/reports.js`, all via
`src/helpers/renderViaWorker.js`:

| Route | `fn` |
|---|---|
| `GET /api/reports/pdf` | `renderReportPdf` |
| `GET /api/reports/image` | `renderReportImage` |
| `GET /api/reports/face/image` | `renderFaceReportImage` |
| `GET /api/reports/face/pdf` | `renderFaceReportPdf` |
| `GET /api/reports/lpr/image` | `renderLprReportImage` |
| `GET /api/reports/lpr/pdf` | `renderLprReportPdf` |
| `POST /api/reports/send-now` | `renderReportImage` **or** `renderLprReportImage` (2 sites) |

**Fallback** — worker dead, connection refused, non-2xx, or 120 s timeout ⇒ the helper renders
in-process and logs `[renderViaWorker] … เรนเดอร์ในโปรเซสแทน`. The download button keeps working
even when the worker is down. Force in-process with `REPORT_RENDER_VIA_WORKER=0`; it also falls
back when `INTERNAL_API_SECRET` is unset, since the request would only earn a `401`.

> ⚠️ A manual download queues **behind** scheduled reports — `report-renderer` serialises
> `_withPage`. A busy worker does not fail fast into the fallback; the caller waits out the
> full 120 s timeout first.

**Still rendered in-process, not via the worker:**
- Health Report PNG **and** PDF — `src/routes/health.js:1142/1183/1245`
- the 3 traffic PDF routes — `/api/traffic/helmet-top/report.pdf`,
  `/api/traffic/helmet-top/report-table.pdf`, `/api/traffic/export-page.pdf`
  (`src/routes/traffic.js:998/1023/1325/1358`)

---

## WebSocket

Connect to `ws://localhost:3000` (or `wss://` via Cloudflare Tunnel).

### Authentication — at the HTTP upgrade only

> ⚠️ There is **no `{"type":"auth"}` message.** Earlier revisions of this doc described one; it
> has never existed in the code. The only inbound message the server understands is `subscribe`
> (below) — an `auth` frame is silently ignored and the socket stays unauthenticated, which in
> practice means it was already rejected at the handshake.

`verifyClient` (`api-server.js:42`) resolves a token **before the upgrade completes** and rejects
with `401` when there is none. Token sources, in order:

1. `?token=<session-token>` in the connect URL (Safari ITP fallback)
2. the `session` cookie (sent automatically on a same-origin upgrade)

At that moment the connection's scope is frozen onto the socket and never re-read:

| Property | Meaning |
|---|---|
| `_allowedSites` | Site RBAC (decision #248, GOTCHAS #163) · `null` = unrestricted · read failure ⇒ `[]` (deny) |
| `_allowedViews` | Per-user view authorization (decision #250) — a user 403'd over HTTP must not receive the same data live |
| `_isAdmin` | Gates the `rawXml` scrub below · fail-closed: a missing flag counts as non-admin |

Changing a user's permissions while their tab is open takes effect **on reconnect**, not
immediately. That is accepted — it is not a privilege escalation.

### Client → server

Exactly one message type. Frames larger than 1024 bytes, malformed JSON, or anything that is not
this shape are dropped silently (a throw here would kill the whole connection):

```json
{ "type": "subscribe", "topics": ["lpr", "face"] }
```

`topics` is filtered against `WS_TOPICS = {lpr, face}`; unknown entries are discarded. Sending
`subscribe` again replaces the set. Default on connect is the **empty set**.

### Server → client

| `type` | Payload | Trigger |
|---|---|---|
| `new_event` | `{ event: <full events row> }` | `pg_notify('new_event', <id>)` from mqtt-subscriber |
| `new_face` | `{ event: <row> }` | New face capture/recognition |
| `event_snapshot` | `{ snapshot_file, … }` | Snapshot arrived for an existing event (no `camera_id` — it is derived from the snapshot path) |
| `clip_done` | `{ camera_id, … }` | Recording finished |
| `occupancy_update` | `{ camera_id, … }` | Occupancy counter changed |
| `camera_status` | `{ changes: [ … ] }` | Heartbeat state change |

> `camera_status` is sent straight over `wss.clients` (`api-server.js:3171`), **bypassing**
> `broadcast()` and therefore the site/view filters — it carries no event detail.
> There is no `alert_fired` message; a previous revision of this doc listed one that the code
> has never sent.

#### Payload variants

The same broadcast is serialised up to three ways, chosen per client **after** the view and site
filters (`api-server.js:1778-1811`) — the variant never widens access, only narrows payload:

1. **`lite`** — a client that has not subscribed to a heavy topic (`lpr` = `new_event` with
   `event_type = 'anprAlarm'`, `face` = `new_face`) receives
   `{ type, lite: true, event: {…} }` instead of the full row: `id, camera_id, event_type,
   event_time, rule_name, object_class, snapshot_file, _lprAlert` plus only
   `plate / region / gender / glass` out of `raw_json` (≈200–300 B vs ≈2.7 KB).
   Not "nothing" — counters, menu badges, toasts and the map pulse still need to move for
   events that are not on the user's current page. Measured 2026-09-05: ~10 anprAlarm/s +
   ~3.4 FaceCapture/s = 265–380 KB per 10 s **per open tab** before this split.
2. **scrubbed** — a **non-admin** (auditor included) receiving a full event whose
   `raw_json.rawXml` is a string gets `<ipAddress>` / `<ipv6Address>` / `<macAddress>` replaced
   with `***` (`src/helpers/scrubRawJson.js`). The `lite` variant needs no scrub — it never
   carries `rawXml`.
3. **full** — admins, and anyone subscribed to the topic where no `rawXml` is present.

Each variant is stringified at most once per broadcast, not once per client.

---

---

## 25. Per-user View Authorization

สิทธิ์ระดับ **หน้า/แท็บ/กล้อง** ต่อผู้ใช้ (decision #250–#255) · การบังคับจริงอยู่ที่ `viewGuard`
ชั้นที่ 2 ในสายของ middleware ด้านบน — ฝั่งจอเป็นแค่ความสะดวก

### GET /api/views

**Auth:** any authenticated user (อยู่ใน `CORE_ROUTES` เสมอ — ถ้าไม่อยู่ ผู้ใช้ที่ถูกจำกัดจะไม่มีเมนูเลย)

คืนทะเบียนหน้า/แท็บทั้งหมด **พร้อมสิทธิ์ของผู้เรียกเอง** ฝั่งจอใช้สร้างเมนู เลือกแท็บที่จะเปิด
และตัดสินว่าจะโชว์การ์ด "ไม่มีสิทธิ์" ไหม

```json
{
  "views": [
    { "key": "traffic", "label": "กวดขันวินัยจราจร", "i18n": "nav.traffic",
      "parent": null, "adminOnly": false,
      "tabs": [ { "key": "traffic:helmet", "label": "สถิติหมวกนิรภัย", "enforceable": true } ] }
  ],
  "allowed": ["traffic:helmet"],
  "landing": "traffic:helmet",
  "message": "อยู่ระหว่างการปรับปรุงการให้บริการ"
}
```

| field | ความหมาย |
|---|---|
| `allowed` | `null` = ไม่จำกัด · array = รายการ view key ที่เข้าได้ · `[]` = ไม่เห็นอะไรเลย |
| `landing` | view ที่จะเปิดให้หลัง login (`null` = หน้าแรกที่มีสิทธิ์) |
| `enforceable` | `true` = แท็บมี endpoint ของตัวเอง กันที่ server ได้จริง · **`false` = ซ่อนได้แค่หน้าจอ** (20 จาก 29 แท็บ) |
| `message` | ข้อความจาก `system_settings.restricted_view_message` |

**ไม่ส่ง route list ออกไป** — allowlist อยู่ฝั่ง server เท่านั้น

### PUT /api/users/:id/views

**Auth:** admin

```json
{ "allowed_views": ["traffic:helmet"], "landing_view": "traffic:helmet" }
```

| กติกา | ผล |
|---|---|
| key ที่ไม่มีใน `src/view-registry.js` | `400 unknown view key` |
| `landing_view` ที่ผู้ใช้ไม่ได้รับสิทธิ์ | `400 landing_view is not in allowed_views` |
| `allowed_views: null` | ล้างข้อจำกัดทั้งหมด |
| `allowed_views: []` | ไม่เห็นอะไรเลย (ยัง logout / เปลี่ยนรหัสได้) — **ต่างจาก `null`** |

ได้ทั้งหน้า = ได้ทุกแท็บในหน้านั้นโดยอัตโนมัติ · การเปลี่ยนแปลงถูกบันทึกโดย trigger
`trg_users_authz_audit` (migration 143) ไม่ต้องเขียน audit เอง

### PUT /api/users/:id/cameras

**Auth:** admin

```json
{ "camera_ids": ["hkt-anpr-1", "hkt-anpr-2"] }
```

กล้องต้องมีจริง **และ**อยู่ใน Site ที่ผู้ใช้คนนั้นมีสิทธิ์ ไม่งั้น `400` (ตั้งค่าที่ไม่มีวันมีผลคือกับดักเงียบ) ·
`[]` = **ลบข้อจำกัดรายกล้อง** ไม่ใช่ "ไม่เห็นกล้องไหนเลย"

### PUT /api/settings/restricted_view_message

**Auth:** admin · ข้อความที่ผู้ใช้เห็นเมื่อไปถึงหน้าที่ตัวเองไม่มีสิทธิ์ · 1–300 ตัวอักษร ·
ชุดเดียวใช้ทั้งระบบ

---

## ภาคผนวก A — สารบัญ route ทั้งหมด

> สร้างด้วย `node scripts/check-api-reference.js --list` · **381 route** ใน process ของ api-server
> (ไม่รวม `/favicon.ico` และไม่รวม `src/lpr-receiver.js` ซึ่งเป็นคนละ service)
>
> คอลัมน์ **Auth** คำนวณจากสายของ middleware จริงทั้ง 3 ชั้น ไม่ใช่แค่ guard ที่ route ระบุ:
> `admin (write-gate)` = ตัว route ไม่ได้ระบุ guard เอง แต่ถูก `requireAdminForWrites` กันเพราะเป็น non-GET บน prefix ที่ถูกกัน
>
> หมวดที่ยังไม่มีคำอธิบายแบบละเอียดในหมวด 1–24 (Blacklist, Face Blacklist, Integrations, Sites,
> LPR Watchlist/Gates, Metrics) มีเฉพาะสารบัญนี้ — เป็นงานที่ยังเหลือ ไม่ใช่ว่า endpoint ไม่มีอยู่
>
> **วิธีสร้างตารางข้างล่างใหม่เมื่อเพิ่ม/ลบ route:**
> `npm run check:api -- --list` แล้วเอาผลลัพธ์แทนที่ทุกอย่างระหว่าง `BEGIN route-index`
> กับ `END route-index` · จากนั้นรัน `npm run check:api` เปล่าๆ ให้ขึ้น "✅ ครบ" ทั้ง 2 บรรทัด
> (ตัวเลขท้ายเอกสาร + CLAUDE.md ต้องแก้ตามด้วย — สคริปต์จะบอกเองถ้าไม่ตรง)

<!-- BEGIN route-index — สร้างด้วย `npm run check:api -- --list` ห้ามแก้มือ -->


### Auth & Session (6)

| Method | Path | Auth | Source |
|---|---|---|---|
| POST | `/api/auth/change-password` | session | `auth.js` |
| POST | `/api/auth/login` | public/session | `auth.js` |
| POST | `/api/auth/logout` | public/session | `auth.js` |
| GET | `/api/auth/me` | public/session | `auth.js` |
| GET | `/api/auth/sessions` | session | `auth.js` |
| POST | `/api/auth/sessions/:id/revoke` | session | `auth.js` |

### Users & Permissions (12)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/audit-log` | admin+auditor | `users.js` |
| POST | `/api/csp-report` | session | `users.js` |
| GET | `/api/users` | admin+auditor | `users.js` |
| POST | `/api/users` | admin | `users.js` |
| DELETE | `/api/users/:id` | admin | `users.js` |
| PUT | `/api/users/:id` | admin | `users.js` |
| PUT | `/api/users/:id/camera-mode` | admin | `users.js` |
| PUT | `/api/users/:id/cameras` | admin | `users.js` |
| POST | `/api/users/:id/reset-password` | admin | `users.js` |
| PUT | `/api/users/:id/sites` | admin | `users.js` |
| PUT | `/api/users/:id/views` | admin | `users.js` |
| GET | `/api/views` | session | `api-server.js` |

### Cameras & Snapshots (39)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/camera-offline-alerts/:cameraId` | session | `cameras-status.js` |
| PUT | `/api/camera-offline-alerts/:cameraId` | admin | `cameras-status.js` |
| GET | `/api/cameras` | session | `cameras.js` |
| POST | `/api/cameras` | admin (write-gate) | `cameras.js` |
| DELETE | `/api/cameras/:cameraId` | admin (write-gate) | `cameras.js` |
| PATCH | `/api/cameras/:cameraId/pause` | admin | `cameras.js` |
| GET | `/api/cameras/:id/alarm-server-status` | admin | `cameras-probe.js` |
| POST | `/api/cameras/:id/event-broker-status` | admin | `cameras-httphost.js` |
| POST | `/api/cameras/:id/face-push-token` | admin | `cameras.js` |
| POST | `/api/cameras/:id/httphost-backup` | admin | `cameras-httphost.js` |
| GET | `/api/cameras/:id/httphost-backups` | admin | `cameras-httphost.js` |
| POST | `/api/cameras/:id/httphost-restore` | admin | `cameras-httphost.js` |
| POST | `/api/cameras/:id/httphost-set` | admin | `cameras-httphost.js` |
| POST | `/api/cameras/:id/lpr-push-token` | admin | `cameras.js` |
| GET | `/api/cameras/:id/mqtt-seen` | admin | `cameras.js` |
| POST | `/api/cameras/:id/mqtt/regenerate` | admin | `cameras.js` |
| POST | `/api/cameras/:id/push-mqtt` | admin | `cameras.js` |
| POST | `/api/cameras/:id/reboot` | admin | `health.js` |
| GET | `/api/cameras/:id/sd-status` | admin | `cameras-probe.js` |
| POST | `/api/cameras/bulk-create-channels` | admin | `cameras-probe.js` |
| POST | `/api/cameras/bulk-import` | admin | `cameras-probe.js` |
| POST | `/api/cameras/detect-models` | admin | `cameras-probe.js` |
| GET | `/api/cameras/image-quality-log` | admin+auditor | `cameras-status.js` |
| POST | `/api/cameras/lpr-forward-test` | admin | `cameras-probe.js` |
| POST | `/api/cameras/probe-snapshot` | admin (write-gate) | `cameras-probe.js` |
| GET | `/api/cameras/quiet` | session | `cameras-status.js` |
| PATCH | `/api/cameras/reorder` | admin | `cameras.js` |
| POST | `/api/cameras/scan-nvr` | admin (write-gate) | `cameras-probe.js` |
| GET | `/api/cameras/scan-nvr/:scanId` | session | `cameras-probe.js` |
| POST | `/api/cameras/snapshot-preview` | admin | `cameras-probe.js` |
| GET | `/api/cameras/status-current` | admin+auditor | `cameras-status.js` |
| GET | `/api/cameras/status-log` | session | `cameras-status.js` |
| POST | `/api/cameras/test-connection` | admin | `cameras-probe.js` |
| GET | `/api/config` | session | `cameras.js` |
| GET | `/api/groups` | session | `groups.js` |
| POST | `/api/groups` | admin (write-gate) | `groups.js` |
| DELETE | `/api/groups/:groupId` | admin (write-gate) | `groups.js` |
| GET | `/api/snapshot/live/:cameraId` | session | `cameras-status.js` |
| GET | `/media/:filename` | public/session | `media-files.js` |
| GET | `/snapshots/*path` | session | `media-files.js` |

### Events & Categories (16)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/categories` | session | `categories.js` |
| POST | `/api/categories` | admin (write-gate) | `categories.js` |
| DELETE | `/api/categories/:id` | admin (write-gate) | `categories.js` |
| PUT | `/api/categories/:id` | admin (write-gate) | `categories.js` |
| GET | `/api/categories/:id/rules` | session | `categories.js` |
| POST | `/api/categories/:id/rules` | admin (write-gate) | `categories.js` |
| GET | `/api/categories/backup` | session | `categories.js` |
| POST | `/api/categories/bulk-delete` | admin (write-gate) | `categories.js` |
| POST | `/api/categories/restore` | admin (write-gate) | `categories.js` |
| GET | `/api/categories/rule-discovery` | session | `categories.js` |
| DELETE | `/api/category-rules/:id` | admin (write-gate) | `categories.js` |
| GET | `/api/events` | session | `events.js` |
| GET | `/api/events/:id/appearance` | session | `events.js` |
| GET | `/api/events/:id/dwell` | session | `events.js` |
| GET | `/api/events/facets` | session | `events.js` |
| GET | `/api/heatmap` | session | `stats-core.js` |

### Faces (11)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/face-matches` | session | `faces.js` |
| POST | `/api/face-matches/:id/ack` | session | `faces.js` |
| GET | `/api/face-matches/:id/note` | session | `faces.js` |
| POST | `/api/face-matches/:id/note` | session | `faces.js` |
| POST | `/api/face-matches/:id/notify` | admin | `faces.js` |
| POST | `/api/face-matches/:id/notify-telegram` | admin | `faces.js` |
| GET | `/api/face-matches/groups` | session | `faces.js` |
| GET | `/api/faces` | session | `faces.js` |
| GET | `/api/faces/counts` | session | `faces.js` |
| GET | `/api/faces/stats` | session | `faces.js` |
| GET | `/api/faces/summary` | session | `faces.js` |

### Face Blacklist (AuraFace) (18)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/face-blacklist/bridge/preview` | session | `face-blacklist.js` |
| GET | `/api/face-blacklist/bridge/rules` | session | `face-blacklist.js` |
| POST | `/api/face-blacklist/bridge/rules` | admin (write-gate) | `face-blacklist.js` |
| DELETE | `/api/face-blacklist/bridge/rules/:id` | admin (write-gate) | `face-blacklist.js` |
| PUT | `/api/face-blacklist/bridge/rules/:id` | admin (write-gate) | `face-blacklist.js` |
| POST | `/api/face-blacklist/bridge/sync` | admin (write-gate) | `face-blacklist.js` |
| GET | `/api/face-blacklist/groups` | session | `face-blacklist.js` |
| POST | `/api/face-blacklist/groups` | admin (write-gate) | `face-blacklist.js` |
| DELETE | `/api/face-blacklist/groups/:id` | admin (write-gate) | `face-blacklist.js` |
| PATCH | `/api/face-blacklist/groups/:id` | admin (write-gate) | `face-blacklist.js` |
| GET | `/api/face-blacklist/hits` | session | `face-blacklist.js` |
| GET | `/api/face-blacklist/hits/:id` | session | `face-blacklist.js` |
| GET | `/api/face-blacklist/roster` | session | `face-blacklist.js` |
| POST | `/api/face-blacklist/roster` | admin (write-gate) | `face-blacklist.js` |
| GET | `/api/face-blacklist/roster/:id` | session | `face-blacklist.js` |
| PUT | `/api/face-blacklist/roster/:id` | admin (write-gate) | `face-blacklist.js` |
| PUT | `/api/face-blacklist/roster/:id/active` | admin (write-gate) | `face-blacklist.js` |
| POST | `/api/face-blacklist/roster/upload` | admin (write-gate) | `face-blacklist.js` |

### Blacklist Sources & Master (34)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/blacklist/bridge/preview` | session | `blacklist-sources-bridge.js` |
| GET | `/api/blacklist/bridge/rules` | session | `blacklist-sources-bridge.js` |
| POST | `/api/blacklist/bridge/rules` | admin (write-gate) | `blacklist-sources-bridge.js` |
| DELETE | `/api/blacklist/bridge/rules/:id` | admin (write-gate) | `blacklist-sources-bridge.js` |
| PUT | `/api/blacklist/bridge/rules/:id` | admin (write-gate) | `blacklist-sources-bridge.js` |
| POST | `/api/blacklist/bridge/sync` | admin (write-gate) | `blacklist-sources-bridge.js` |
| GET | `/api/blacklist/duplicates` | session | `blacklist-sources-curation.js` |
| POST | `/api/blacklist/duplicates/remove` | admin (write-gate) | `blacklist-sources-curation.js` |
| POST | `/api/blacklist/manual/face` | admin (write-gate) | `blacklist-sources-bridge.js` |
| POST | `/api/blacklist/manual/lpr` | admin (write-gate) | `blacklist-sources-bridge.js` |
| GET | `/api/blacklist/master` | session | `blacklist-sources.js` |
| GET | `/api/blacklist/master/:id` | session | `blacklist-sources.js` |
| POST | `/api/blacklist/master/:id/reveal-id` | admin (write-gate) | `blacklist-sources-curation.js` |
| GET | `/api/blacklist/photo/:sourceId/:file` | session | `blacklist-sources-curation.js` |
| GET | `/api/blacklist/quality` | session | `blacklist-sources-curation.js` |
| GET | `/api/blacklist/record/:id` | session | `blacklist-sources-curation.js` |
| GET | `/api/blacklist/record/:id/changes` | session | `blacklist-sources-curation.js` |
| PUT | `/api/blacklist/record/:id/override` | admin (write-gate) | `blacklist-sources-curation.js` |
| POST | `/api/blacklist/record/:id/photo` | admin (write-gate) | `blacklist-sources-curation.js` |
| GET | `/api/blacklist/removed` | session | `blacklist-sources.js` |
| GET | `/api/blacklist/settings` | session | `blacklist-sources-curation.js` |
| PUT | `/api/blacklist/settings` | admin (write-gate) | `blacklist-sources-curation.js` |
| GET | `/api/blacklist/sources` | session | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources` | admin (write-gate) | `blacklist-sources-import.js` |
| DELETE | `/api/blacklist/sources/:id` | admin (write-gate) | `blacklist-sources-import.js` |
| PUT | `/api/blacklist/sources/:id` | admin (write-gate) | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources/:id/import` | admin (write-gate) | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources/:id/orphans` | admin (write-gate) | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources/:id/push-apply` | admin (write-gate) | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources/:id/push-enable` | admin (write-gate) | `blacklist-sources-import.js` |
| GET | `/api/blacklist/sources/:id/push-preview` | session | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources/discover` | admin (write-gate) | `blacklist-sources-import.js` |
| POST | `/api/blacklist/sources/test-connection` | admin (write-gate) | `blacklist-sources-import.js` |
| GET | `/api/blacklist/stats` | session | `blacklist-sources.js` |

### LPR (40)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/lpr` | session | `lpr-list.js` |
| POST | `/api/lpr/alert-preview` | session | `lpr-watchlist.js` |
| GET | `/api/lpr/alerts` | session | `lpr-alerts.js` |
| POST | `/api/lpr/alerts/:id/ack` | session | `lpr-alerts.js` |
| POST | `/api/lpr/alerts/:id/notify` | session | `lpr-alerts.js` |
| POST | `/api/lpr/alerts/:id/notify-telegram` | session | `lpr-alerts.js` |
| GET | `/api/lpr/alerts/count` | session | `lpr-alerts.js` |
| GET | `/api/lpr/brands` | session | `lpr-query.js` |
| PUT | `/api/lpr/camera-direction` | session | `lpr-gates.js` |
| GET | `/api/lpr/gates` | session | `lpr-gates.js` |
| POST | `/api/lpr/gates` | session | `lpr-gates.js` |
| DELETE | `/api/lpr/gates/:id` | session | `lpr-gates.js` |
| PATCH | `/api/lpr/gates/:id` | session | `lpr-gates.js` |
| GET | `/api/lpr/gs-alarms` | session | `lpr-gs-alarms.js` |
| POST | `/api/lpr/gs-alarms/:id/notify` | session | `lpr-gs-alarms.js` |
| POST | `/api/lpr/gs-alarms/:id/notify-telegram` | session | `lpr-gs-alarms.js` |
| GET | `/api/lpr/gs-alarms/:id/photo/:kind` | session | `lpr-gs-alarms.js` |
| GET | `/api/lpr/gs-alarms/meta` | session | `lpr-gs-alarms.js` |
| DELETE | `/api/lpr/mismatch/:plate/dismiss` | session | `lpr-list.js` |
| POST | `/api/lpr/mismatch/:plate/dismiss` | session | `lpr-list.js` |
| GET | `/api/lpr/no-read` | session | `lpr-list.js` |
| GET | `/api/lpr/plate-history` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/buckets` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/daily` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/plate/:plate` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/ranking` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/rejections` | session | `lpr-list.js` |
| DELETE | `/api/lpr/truck-ban/rejections/:plate` | session | `lpr-list.js` |
| POST | `/api/lpr/truck-ban/rejections/:plate` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/report-table.pdf` | session | `lpr-list.js` |
| GET | `/api/lpr/truck-ban/report.pdf` | session | `lpr-list.js` |
| GET | `/api/lpr/scene-image` | session | `lpr-gates.js` |
| PUT | `/api/lpr/scene-image` | session | `lpr-gates.js` |
| DELETE | `/api/lpr/spool/clear` | admin | `health.js` |
| GET | `/api/lpr/stats` | session | `lpr-query.js` |
| GET | `/api/lpr/vehicle-types` | session | `lpr-gates.js` |
| PUT | `/api/lpr/vehicle-types` | session | `lpr-gates.js` |
| GET | `/api/lpr/watchlist` | session | `lpr-watchlist.js` |
| POST | `/api/lpr/watchlist` | session | `lpr-watchlist.js` |
| DELETE | `/api/lpr/watchlist/:plate` | session | `lpr-watchlist.js` |
| PATCH | `/api/lpr/watchlist/:plate` | session | `lpr-watchlist.js` |
| DELETE | `/api/lpr/watchlist/:plate/mute` | session | `lpr-watchlist.js` |
| POST | `/api/lpr/watchlist/:plate/mute` | session | `lpr-watchlist.js` |
| POST | `/api/lpr/watchlist/bulk-delete` | session | `lpr-watchlist.js` |
| GET | `/api/lpr/watchlist/groups` | session | `lpr-watchlist.js` |
| POST | `/api/lpr/watchlist/groups` | session | `lpr-watchlist.js` |
| DELETE | `/api/lpr/watchlist/groups/:id` | session | `lpr-watchlist.js` |
| PATCH | `/api/lpr/watchlist/groups/:id` | session | `lpr-watchlist.js` |
| POST | `/api/lpr/watchlist/image` | session | `lpr-watchlist.js` |

### Traffic Enforcement (7)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/traffic/enforcement` | session | `traffic.js` |
| POST | `/api/traffic/export-page.pdf` | session | `traffic-report-pdf.js` |
| GET | `/api/traffic/helmet-series` | session | `traffic.js` |
| GET | `/api/traffic/helmet-top` | session | `traffic.js` |
| GET | `/api/traffic/helmet-top/plate` | session | `traffic.js` |
| GET | `/api/traffic/helmet-top/report-table.pdf` | session | `traffic-report-pdf.js` |
| GET | `/api/traffic/helmet-top/report.pdf` | session | `traffic-report-pdf.js` |

### Appearances (4)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/appearances/search` | session | `appearances.js` |
| GET | `/api/appearances/similar-timeline` | session | `appearances.js` |
| GET | `/api/appearances/stats` | session | `appearances.js` |
| GET | `/api/appearances/timeline` | session | `appearances.js` |

### Statistics (30)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/stats/alert-effectiveness` | session | `stats-report.js` |
| GET | `/api/stats/breakdown` | session | `stats-core.js` |
| GET | `/api/stats/breakdown-v2` | session | `stats-report.js` |
| GET | `/api/stats/categories` | session | `stats.js` |
| GET | `/api/stats/dwell` | session | `stats-core.js` |
| GET | `/api/stats/event-coverage` | session | `stats-report.js` |
| GET | `/api/stats/evidence` | session | `stats-report.js` |
| GET | `/api/stats/executive-summary` | session | `stats-summary-route.js` |
| GET | `/api/stats/face/report` | session | `faces.js` |
| GET | `/api/stats/forensic-summary` | session | `stats-report.js` |
| GET | `/api/stats/heatmap` | session | `stats.js` |
| GET | `/api/stats/kpi` | session | `stats-core.js` |
| GET | `/api/stats/lpr/report` | session | `lpr-query.js` |
| GET | `/api/stats/object-counts` | session | `stats.js` |
| GET | `/api/stats/occupancy` | session | `stats-occupancy.js` |
| GET | `/api/stats/occupancy/heatmap` | session | `stats-occupancy.js` |
| GET | `/api/stats/occupancy/sources` | session | `stats-occupancy.js` |
| GET | `/api/stats/occupancy/timeline` | session | `stats-occupancy.js` |
| GET | `/api/stats/pattern-heatmap` | session | `stats.js` |
| GET | `/api/stats/people-counting` | session | `stats-core.js` |
| GET | `/api/stats/per-camera-counts` | session | `stats.js` |
| GET | `/api/stats/quiet-cameras` | session | `stats.js` |
| GET | `/api/stats/timeline` | session | `stats-core.js` |
| GET | `/api/stats/timeline-by-category` | session | `stats.js` |
| GET | `/api/stats/timeline-v2` | session | `stats.js` |
| GET | `/api/stats/timeseries-rules` | session | `stats-core.js` |
| GET | `/api/stats/today-counts` | session | `stats-core.js` |
| GET | `/api/stats/top-rules` | session | `stats.js` |
| GET | `/api/stats/vehicle-cards` | session | `stats.js` |
| GET | `/api/stats/vehicle-classes` | session | `stats-core.js` |

### Reports (17)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/report-history` | session | `reports.js` |
| GET | `/api/report-history/:id/image` | session | `reports.js` |
| GET | `/api/report-history/stats` | session | `reports.js` |
| GET | `/api/report-schedules` | session | `report-schedules.js` |
| POST | `/api/report-schedules` | admin (write-gate) | `report-schedules.js` |
| DELETE | `/api/report-schedules/:id` | admin (write-gate) | `report-schedules.js` |
| PUT | `/api/report-schedules/:id` | admin (write-gate) | `report-schedules.js` |
| POST | `/api/report-schedules/:id/run` | admin (write-gate) | `report-schedules.js` |
| GET | `/api/reports/daily` | session | `reports.js` |
| GET | `/api/reports/face/image` | session | `reports.js` |
| GET | `/api/reports/face/pdf` | session | `reports.js` |
| GET | `/api/reports/image` | session | `reports.js` |
| GET | `/api/reports/lpr/image` | session | `reports.js` |
| GET | `/api/reports/lpr/pdf` | session | `reports.js` |
| GET | `/api/reports/pdf` | session | `reports.js` |
| POST | `/api/reports/send-now` | admin (write-gate) | `reports.js` |
| GET | `/api/reports/weekly` | session | `reports.js` |

### LINE & Alerts (48)

| Method | Path | Auth | Source |
|---|---|---|---|
| DELETE | `/api/alert-logs` | admin | `ops.js` |
| GET | `/api/alert-logs` | session | `ops.js` |
| GET | `/api/alert-logs/stats` | session | `ops.js` |
| GET | `/api/alert-rules` | session | `alert-rules.js` |
| POST | `/api/alert-rules` | admin (write-gate) | `alert-rules.js` |
| GET | `/api/alert-rules-suggestions` | session | `alert-rules.js` |
| DELETE | `/api/alert-rules/:id` | admin (write-gate) | `alert-rules.js` |
| PUT | `/api/alert-rules/:id` | admin (write-gate) | `alert-rules.js` |
| GET | `/api/line-config` | admin+auditor | `line.js` |
| PUT | `/api/line-config` | admin (write-gate) | `line.js` |
| GET | `/api/line-config/qr` | session | `line.js` |
| GET | `/api/line-config/quota` | session | `line.js` |
| PUT | `/api/line-config/quota-alert` | admin | `line.js` |
| POST | `/api/line-config/test` | admin | `line.js` |
| GET | `/api/line/blocked` | admin | `line.js` |
| POST | `/api/line/blocked/:id/unblock` | admin | `line.js` |
| GET | `/api/line/command-actions` | admin+auditor | `line-commands.js` |
| GET | `/api/line/command-log` | admin+auditor | `line-commands.js` |
| GET | `/api/line/command-sources` | admin+auditor | `line-commands.js` |
| GET | `/api/line/commands` | admin+auditor | `line-commands.js` |
| POST | `/api/line/commands` | admin | `line-commands.js` |
| DELETE | `/api/line/commands/:id` | admin | `line-commands.js` |
| PATCH | `/api/line/commands/:id` | admin | `line-commands.js` |
| POST | `/api/line/commands/test` | admin | `line-commands.js` |
| GET | `/api/line/known-senders` | admin+auditor | `line-commands.js` |
| GET | `/api/line/operator-scope/:userId` | admin+auditor | `line-commands.js` |
| GET | `/api/line/operators` | admin+auditor | `line-commands.js` |
| POST | `/api/line/operators` | admin | `line-commands.js` |
| DELETE | `/api/line/operators/:id` | admin | `line-commands.js` |
| PATCH | `/api/line/operators/:id` | admin | `line-commands.js` |
| PUT | `/api/line/operators/:id/telegram-allow-in` | admin | `line-commands.js` |
| DELETE | `/api/line/operators/:id/telegram-link` | admin | `line-commands.js` |
| POST | `/api/line/operators/:id/telegram-link` | admin | `line-commands.js` |
| GET | `/api/line/pending` | admin | `line.js` |
| POST | `/api/line/pending/:id/approve` | admin | `line.js` |
| POST | `/api/line/pending/:id/block` | admin | `line.js` |
| POST | `/api/line/pending/:id/ignore` | admin | `line.js` |
| POST | `/api/line/webhook` | session | `line.js` |
| POST | `/api/push/register` | session | `ops.js` |
| POST | `/api/push/unregister` | session | `ops.js` |
| GET | `/api/telegram-config` | admin+auditor | `telegram.js` |
| PUT | `/api/telegram-config` | admin | `telegram.js` |
| GET | `/api/telegram-config/qr` | session | `telegram.js` |
| POST | `/api/telegram-config/test` | admin | `telegram.js` |
| GET | `/api/telegram/pending` | admin | `telegram.js` |
| POST | `/api/telegram/pending/:chatId/approve` | admin | `telegram.js` |
| POST | `/api/telegram/pending/:chatId/block` | admin | `telegram.js` |
| POST | `/api/telegram/pending/:chatId/ignore` | admin | `telegram.js` |

### Sites & Map (16)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/map/areas` | session | `map.js` |
| DELETE | `/api/map/areas/:areaId` | admin (write-gate) | `map.js` |
| DELETE | `/api/map/cache` | admin (write-gate) | `map.js` |
| POST | `/api/map/cancel` | admin (write-gate) | `map.js` |
| POST | `/api/map/download` | admin (write-gate) | `map.js` |
| POST | `/api/map/estimate` | admin (write-gate) | `map.js` |
| GET | `/api/map/progress` | session | `map.js` |
| GET | `/api/map/tiles/mapbox/:style/:z/:x/:y.png` | session | `map.js` |
| GET | `/api/sites` | session | `sites.js` |
| POST | `/api/sites` | admin | `sites.js` |
| DELETE | `/api/sites/:id` | admin | `sites.js` |
| PUT | `/api/sites/:id` | admin | `sites.js` |
| POST | `/api/sites/:id/purge` | admin | `sites.js` |
| GET | `/api/sites/:id/purge-plan` | admin | `sites.js` |
| POST | `/api/sites/:id/provision-edge` | admin | `sites.js` |
| POST | `/api/sites/:id/push-config` | admin | `sites.js` |
| PUT | `/api/sites/:id/retention` | admin | `sites.js` |
| PUT | `/api/sites/:id/status` | admin | `sites.js` |
| PUT | `/api/sites/order` | admin | `sites.js` |
| GET | `/api/sites/purge-job` | admin | `sites.js` |

### Health, Metrics & Ops (18)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/backups` | admin+auditor | `ops.js` |
| GET | `/api/backups/:filename` | admin | `ops.js` |
| POST | `/api/backups/run` | admin | `ops.js` |
| POST | `/api/devices/nvr/:deviceId/reboot` | admin | `health.js` |
| POST | `/api/edge/:site/services/:name/:action` | admin | `health.js` |
| GET | `/api/health/details` | admin+auditor | `health.js` |
| GET | `/api/health/devices` | admin+auditor | `devices.js` |
| GET | `/api/health/relay` | session | `health-reporting.js` |
| GET | `/api/health/relay/report.pdf` | session | `health-reporting.js` |
| GET | `/api/health/report-data/alerts` | session | `health-reporting.js` |
| GET | `/api/health/report-data/cameras` | session | `health-reporting.js` |
| GET | `/api/health/report/pdf` | session | `health-reporting.js` |
| GET | `/api/health/report/preview` | session | `health-reporting.js` |
| POST | `/api/health/report/send-now` | session | `health-reporting.js` |
| GET | `/api/metrics/device` | admin+auditor | `metrics.js` |
| GET | `/api/metrics/host` | admin+auditor | `metrics.js` |
| GET | `/api/metrics/sources` | admin+auditor | `metrics.js` |
| POST | `/api/services/:name/:action` | admin | `health.js` |

### HCP (HikCentral) (7)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/hcp/cameras` | admin | `hcp.js` |
| GET | `/api/hcp/devices` | admin | `hcp.js` |
| GET | `/api/hcp/engine-stats` | admin | `hcp.js` |
| GET | `/api/hcp/events` | admin | `hcp.js` |
| POST | `/api/hcp/face-search` | admin | `hcp.js` |
| GET | `/api/hcp/nearby` | admin | `hcp.js` |
| GET | `/api/hcp/picture` | admin | `hcp.js` |

### Integrations (12)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/integrations` | admin | `integrations.js` |
| POST | `/api/integrations` | admin | `integrations.js` |
| DELETE | `/api/integrations/:slug` | admin | `integrations.js` |
| PATCH | `/api/integrations/:slug` | admin | `integrations.js` |
| GET | `/api/integrations/:slug/endpoint-usage` | admin | `integrations.js` |
| POST | `/api/integrations/:slug/extend` | admin | `integrations.js` |
| GET | `/api/integrations/:slug/agreements` | admin | `integrations.js` |
| POST | `/api/integrations/:slug/agreements` | admin | `integrations.js` |
| PUT | `/api/integrations/:slug/grants` | admin | `integrations.js` |
| GET | `/api/integrations/:slug/openapi` | admin | `integrations.js` |
| GET | `/api/integrations/:slug/preview` | admin | `integrations.js` |
| POST | `/api/integrations/:slug/reactivate` | admin | `integrations.js` |
| POST | `/api/integrations/:slug/reveal` | admin | `integrations.js` |
| POST | `/api/integrations/:slug/revoke` | admin | `integrations.js` |
| POST | `/api/integrations/:slug/rotate` | admin | `integrations.js` |

### Settings, Branding, License & EULA (15)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/branding` | session | `branding.js` |
| DELETE | `/api/branding/footer-logo` | session | `branding.js` |
| POST | `/api/branding/footer-logo` | session | `branding.js` |
| DELETE | `/api/branding/logo` | session | `branding.js` |
| POST | `/api/branding/logo` | session | `branding.js` |
| GET | `/api/eula` | session | `eula.js` |
| POST | `/api/eula/accept` | session | `eula.js` |
| GET | `/api/eula/status` | session | `eula.js` |
| POST | `/api/license/activate` | admin (write-gate) | `license.js` |
| POST | `/api/license/deactivate` | admin (write-gate) | `license.js` |
| GET | `/api/license/machine-id` | session | `license.js` |
| GET | `/api/license/status` | session | `license.js` |
| GET | `/api/settings` | session | `settings.js` |
| PUT | `/api/settings/:key` | admin (write-gate) | `settings.js` |
| PUT | `/api/settings/map` | admin | `settings.js` |

### Partner API (/v1) (6)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/v1/cameras` | partner AK/SK | `partner-api.js` |
| GET | `/v1/enforcement/cameras` | partner AK/SK | `partner-api.js` |
| GET | `/v1/stats/vehicles/hourly` | partner AK/SK | `partner-api.js` |
| GET | `/v1/stats/lpr/hourly` | partner AK/SK | `partner-api.js` |
| GET | `/v1/stats/lpr/daily` | partner AK/SK | `partner-api.js` |
| GET | `/v1/stats/person/daily` | partner AK/SK | `partner-api.js` |
| GET | `/v1/enforcement/hourly` | partner AK/SK | `partner-api.js` |
| GET | `/v1/enforcement/daily` | partner AK/SK | `partner-api.js` |
| GET | `/v1/face/events` | partner AK/SK | `partner-api.js` |
| GET | `/v1/healthz` | partner AK/SK | `partner-api.js` |
| GET | `/v1/lpr/events` | partner AK/SK | `partner-api.js` |
| POST | `/v1/lpr/search` | partner AK/SK | `partner-api.js` |
| GET | `/v1/openapi.json` | partner AK/SK | `partner-api.js` |

### Camera push receivers & tiles (no /api prefix) (28)

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/acuseek/cameras` | session | `acuseek.js` |
| GET | `/api/acuseek/picture` | session | `acuseek.js` |
| GET | `/api/acuseek/queries` | session | `acuseek.js` |
| POST | `/api/acuseek/search` | session | `acuseek.js` |
| POST | `/api/acuseek/status` | session | `acuseek.js` |
| GET | `/api/acuseek/vocab` | session | `acuseek.js` |
| GET | `/api/alert-channels` | session | `alert-channels.js` |
| PUT | `/api/alert-channels/:channel` | admin | `alert-channels.js` |
| POST | `/api/alert-channels/:channel/test` | admin | `alert-channels.js` |
| GET | `/api/files` | admin | `files.js` |
| POST | `/api/files` | admin | `files.js` |
| DELETE | `/api/files/:id` | admin | `files.js` |
| PATCH | `/api/files/:id/expiry` | admin | `files.js` |
| GET | `/api/files/:id/clicks` | admin | `files.js` |
| POST | `/api/files/:id/links` | admin | `files.js` |
| PATCH | `/api/files/:id/target` | admin | `files.js` |
| PATCH | `/api/files/:id/meta` | admin | `files.js` |
| POST | `/api/files/:id/preview` | admin | `files.js` |
| GET | `/api/files/:id/preview.png` | admin | `files.js` |
| POST | `/api/files/:id/replace` | admin | `files.js` |
| POST | `/api/files/:id/versions/:v/restore` | admin | `files.js` |
| POST | `/api/files/link` | admin | `files.js` |
| DELETE | `/api/files/links/:linkId` | admin | `files.js` |
| POST | `/api/jobs/:name/run` | admin | `jobs.js` |
| GET | `/api/storage` | session | `storage.js` |
| POST | `/api/storage/purge` | admin (write-gate) | `storage.js` |
| GET | `/api/storage/purge/:reqId` | session | `storage.js` |
| POST | `/api/storage/scan` | admin (write-gate) | `storage.js` |
| GET | `/dashboard.bundle.js` | session | `static-shell.js` |
| POST | `/face-push/:token` | per-camera token (in path) | `face-push.js` |
| POST | `/lpr` | session | `lpr.js` |
| POST | `/lpr/:token` | per-camera token (in path) | `lpr.js` |
| GET | `/pub/fil/*path` | session | `media-files.js` |
| GET | `/pub/img/*path` | session | `media-files.js` |
| GET | `/pub/ref/*path` | session | `media-files.js` |
| GET | `/pub/rpt/*path` | session | `media-files.js` |
| GET | `/pub/seek/:blob` | session | `acuseek.js` |
| GET | `/tiles/:provider/:style/:z/:x/:y.png` | session | `map.js` |
| GET | `/tiles/:style/:z/:x/:y.png` | session | `map.js` |

<!-- END route-index -->

---

<sub>**REF_api-reference.md** v1.5.4 · **419 routes** (api-server process; ไม่รวม lpr-receiver) · หมวด 1–25 = รายละเอียด · ภาคผนวก A = สารบัญครบทุก route · Vigil Platform · Updated 2026-11-02</sub>
