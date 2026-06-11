# SKILL.md — Vigil Platform Operations

> Operator's core playbook: mental model, mapping recipes, branding,
> health check overview, and feature summaries.
>
> **Troubleshooting steps** → `docs/REF_troubleshooting.md`
> **SQL snippets + service commands** → `docs/REF_operator-sql.md`
> **Design rationale** → `docs/LOGIC_*.md` files
>
> Last updated: 2026-06-08 · v1.5.3

---

## Table of Contents

1. [Mental model](#1-mental-model)
2. [Bosch IVA event shape](#2-bosch-iva-event-shape)
3. [Mapping rule recipes](#3-mapping-rule-recipes)
4. [System Settings reference](#4-system-settings-reference)
5. [White-label branding](#5-white-label-branding)
6. [Health Check page](#6-health-check-page)
7. [Reports overview](#7-reports-overview)
8. [Language / i18n](#8-language--i18n-thai--english)
9. [Camera Offline Alerts (Ph.1)](#9-camera-offline-alerts-ph1)
10. [Report History (Ph.2)](#10-report-history-ph2)
11. [System Health Report (Ph.3)](#11-system-health-report-ph3)
12. [Auditor role](#12-auditor-role-read-only)
13. [License notes (Phase 8)](#13-license-operator-notes-phase-8)
14. [Dahua snapshot notes](#14-dahua-snapshot-notes)
15. [Camera Pause](#15-camera-pause)
16. [Runtime stack reference](#16-runtime-stack-reference)

---

## 1. Mental model

```
┌─────────┐         ┌──────────────────────┐         ┌──────────────────────┐
│ Cameras │ ──────► │  events (raw rows)   │ ──join─►│  event_categories    │
└─────────┘  MQTT   │  rule_name, type,    │  rules  │  (display grouping)  │
                    │  state, object_class │         └──────────────────────┘
                    └──────────────────────┘
```

- **Events** are immutable raw observations.
- **Categories** are display labels (created by admin).
- **Mapping rules** decide which raw events feed into which categories.
- A single event can be in **many categories** (all-match).
- Category counts are **always recomputed at query time** — edit a mapping → effect is immediate, retroactive.

### Event pipeline — 3 layers

```
┌────────────┐   ┌──────────┐   ┌──────────────────────────────┐
│ 1. CAMERA  │──►│ 2.BROKER │──►│ 3. DASHBOARD                 │
│ (IVA/VCA)  │   │  (EMQX)  │   │ subscriber → DB → API → UI   │
└────────────┘   └──────────┘   └──────────────────────────────┘
  decides what    pure transport   can DROP (IGNORED_EVENT_TYPES)
  to detect &     — never adds,    or HIDE (analytics_event_display)
  fire as event   drops, or edits  but cannot INVENT what camera missed
```

**Golden rule for debugging:** raw MQTT count vs DB count. If equal, the problem is the camera (layer 1). See `docs/REF_troubleshooting.md §8.15`.

### Stats drill-down sanity check

When a Stats visual links to Events (Live), compare the source endpoint
and target endpoint scopes, not only the visible label.

| Source visual | Source API | Target must include |
|---|---|---|
| Activity Heatmap | `/api/stats/heatmap` | `from`, `to`, `cameras`, `category_id`, `dow`, `hour` |
| Category KPI / pie | `/api/stats/categories` | `from`, `to`, `cameras`, `category_id` |
| Per-camera bars | `/api/stats/per-camera-counts` | `from`, `to`, `camera`, class/category constraints |
| Top Rules | `/api/stats/top-rules` | `from`, `to`, `cameras`, `rule_name` |

If the numbers differ, first inspect the actual `/api/events?...` query string.
The Events page paginates server-side, so all drill filters must reach
`/api/events` before `LIMIT/OFFSET`. See GOTCHAS #44.

---

## 2. Bosch IVA event shape

| `event_type` | `object_class` | `state` | What it represents |
|---|---|---|---|
| `LineDetector/Crossed` | `Person` (etc.) | `''` / NULL | One row = one crossing event |
| `FieldDetector/ObjectsInside` | NULL | `'true'`/`'false'` | Enter / leave a watched area |
| `ObjectTrack/Aggregation` | `Person` (etc.) | NULL | Tracker aggregation — fires multiple times |
| `VideoSource/GlobalSceneChange` | NULL | `'true'`/`'false'` | Scene change (lighting, big motion) |
| `MotionAlarm` | — | — | **Filtered out** before insert |
| `RecordingConfig/JobState` | — | — | **Filtered out** before insert |

**Key:** `state` only populated for FieldDetector / SceneChange. LineDetector rows have `state = NULL` → mapping rule with `match_state='true'` will miss them entirely.

---

## 3. Mapping rule recipes

`(any)` = NULL in UI = wildcard matches anything.

### 3.1 — Count every person who crosses any line (any camera)

| Field | Value |
|---|---|
| Camera | `* (any)` |
| Rule Name | `(blank = any)` |
| Event Type | `LineDetector/Crossed` |
| Object Class | `Person` |
| State | `(any)` |

### 3.2 — Count people entering a forbidden area (enter only)

| Field | Value |
|---|---|
| Camera | `(any)` |
| Rule Name | `ห้ามคนเข้า` *(your IVA rule name — "No Entry" in this example)* |
| Event Type | `FieldDetector/ObjectsInside` |
| Object Class | `(any)` |
| State | `true (enter)` |

Use `State = true` — counts once when they enter, not twice.

### 3.3 — Catch-all "Alerts" category (any rule firing)

| Field | Value |
|---|---|
| Camera | `(any)` |
| Rule Name | `(blank = any)` |
| Event Type | `(blank = any)` |
| Object Class | `(any)` |
| State | `(any)` |

### 3.4 — Vehicle counter (any class)

Add one rule per class to the Vehicle Counting category:

```
event_type=LineDetector/Crossed, object_class=Car,        state=(any)
event_type=LineDetector/Crossed, object_class=Truck,      state=(any)
event_type=LineDetector/Crossed, object_class=Bus,        state=(any)
event_type=LineDetector/Crossed, object_class=Motorcycle, state=(any)
event_type=LineDetector/Crossed, object_class=Bicycle,    state=(any)
event_type=LineDetector/Crossed, object_class=Van,        state=(any)
event_type=LineDetector/Crossed, object_class=Vehicle,    state=(any)
```

### 3.5 — Camera-specific rule

| Field | Value |
|---|---|
| Camera | `BoschCam1` |
| Rule Name | `WrongWay` |
| Event Type | `(any)` |
| State | `true (enter)` |

---

## 4. System Settings reference

→ Full reference with SQL edit commands: `docs/REF_operator-sql.md`

Quick lookup of keys:

**Data retention**

| Key | Default | Effect |
|---|---|---|
| `data_retention_days` | `365` | Daily DELETE of old events (max 730) |
| `snapshot_retention_days` | `30` | Daily file unlink of old snapshot images (max 365) |
| `clip_retention_days` | `30` | Daily file unlink of pre-alarm video clips (max 90) |
| `appearances_retention_days` | `30` | Days of appearance attribute data (gender/colour/clothing) before anonymisation; must be ≤ `data_retention_days` (max 730) |

**Stats / display**

| Key | Default | Effect |
|---|---|---|
| `display_timezone` | `Asia/Bangkok` | Day-boundary alignment for all stats |
| `counter_dedup_mode` | `state` | People/vehicle counter dedup — `state` (enter-only via state=true), `object_window` (object-ID window), `none` (count every row) |
| `comparison_mode` | `rolling` | Period comparison in stats — `rolling` (last N days) or `calendar` (same month last year) |
| `custom_range_max_days` | `365` | Max span for custom date-range picker |
| `analytics_event_display` | `ImageTooBright,ImageTooBlurry,ImageTooDark,GlobalSceneChange` | CSV of camera-automation event types shown in Stats/Events feed (others hidden but still stored) |

**Branding**

| Key | Default | Effect |
|---|---|---|
| `brand_name` | `Vigil Platform` | Product name in sidebar, login, disclaimer, PDF header |
| `brand_tagline` | `CCTV Analytics Suite` | Subtitle shown under brand name |
| `brand_logo_path` | `''` | Path under `/branding/` (e.g. `logo.png`); empty = default SVG placeholder |
| `brand_primary_color` | `#5b8def` | CSS `--accent` color across all UI |

**Map**

| Key | Default | Effect |
|---|---|---|
| `mapbox_token` | `''` | Mapbox public token (`pk.…`) for detailed tile layers; empty = OSM tiles only. Set via Settings → Map |

---

## 5. White-label branding

### Where the brand appears

| Location | What's branded |
|---|---|
| Sidebar header | logo + name + tagline |
| Browser tab favicon | logo |
| Login / Disclaimer page | logo + product name |
| PDF Reports | logo + name in header |
| CSS `--accent` | primary color across all UI |

### How to set it

Settings → ⚙️ System → 🎨 Branding (admin only):
- Upload logo (PNG/JPG/WebP/SVG, max 5MB) → auto-resize 256×256 PNG
- Edit name (`brand_name`), tagline (`brand_tagline`), accent color (`brand_primary_color`)

```bash
# API — upload logo
curl -F "logo=@logo.png" -H "Cookie: <session>" \
  http://localhost:3000/api/branding/logo

# Public read (no auth needed)
curl http://localhost:3000/api/branding
# → {name, tagline, logo_url, primary_color}  ← use THESE names, not brand_* keys
```

> Footer `© DojoJin Tech` is **hardcoded** — only the product name on the left is editable.

---

## 6. Health Check page

Sidebar → **💓 Health Check** (admin only). Auto-refreshes every 15s.

| Card | Shows |
|---|---|
| 🗄️ Database | Postgres latency, total events, 1h/24h event rate |
| 📡 MQTT Pipeline | Last event timestamp, age, status (`healthy`/`idle`/`stale`) |
| 📷 Cameras | online/offline counts (heartbeat <90s) |
| ⚙️ Service Processes | PM2 status per worker (`online`/`stopped`/`errored`); uptime; restart count `↺N` (yellow = has restarted); **Restart** button for all 5 controllable workers + **Stop/Start** (except api-server); 7 workers display status but only 5 have action buttons: api-server/mqtt-subscriber/media-recorder/hikvision/dahua (alert-worker + report-worker = status display only) |
| 📸 Camera Image Quality (24h) | Per-camera auto-analytics count: `too_bright` / `too_blurry` / `too_dark` / `scene_change` — high count = dirty lens / focus drift / changing light / possible obstruction |
| ⚡ Camera Automation Triggers (24h) | Per-camera Digital Input + Relay event counts + latest trigger time (this event group is hidden in Stats per `analytics_event_display`, but shown here to confirm whether the relay fired today) |
| 💾 Storage | Snapshot files/size · Clip files/size/count-24h/oldest · disk free/total · retention days (events/snapshots/clips) |
| ⚙️ API Server | Process uptime, Node version, PID, RSS memory, Heap used, WebSocket clients |
| 🖥️ Host | Hostname, platform, Total/Free RAM, used %, load avg (1m) |

**Status thresholds (level → badge color):**

| Metric | warn 🟡 | err 🔴 |
|---|---|---|
| MQTT | `idle` 5min–1hr | `stale` > 1hr |
| Memory | > 70% | > 85% |
| Disk | > 75% | > 90% |

```bash
curl -H "Cookie: <session>" http://localhost:3000/api/health/details | jq
```

---

## 7. Reports overview

Reports tab → 5 types: **Daily / Weekly / Monthly / Custom / 🏥 Health**

| Type | Range |
|---|---|
| Daily | 00:00–23:59 of selected date (display_timezone) |
| Weekly | Monday 00:00 – Sunday 23:59 |
| Monthly | First to last day of month |
| Custom | from+to, capped by `custom_range_max_days` |
| 🏥 Health | 24h/7d/30d/custom — see §11 |

**Scheduled delivery (Phase 7.3):** Settings → 🔔 LINE → Scheduled Delivery. Each schedule generates PNG → LINE via imgbb. `send_day_of_week` gates weekly; `send_days_of_month` gates monthly. Every fire logged to `report_history` — see §10. LINE delivery rules live in `docs/LOGIC_line-notifications.md`.

**Analytics report export:** click Export PDF → Puppeteer renders A4 PDF (Thai fonts, text selectable).

---

## 8. Language / i18n (Thai / English)

The dashboard is bilingual — engine: `dashboard/i18n.js` (vanilla, no dependencies). Thai is the source language; English is the translation layer.

**Switch language:** click the `ไทย / EN` toggle in the user menu, login page, or disclaimer page → saved to `localStorage.dashboard_lang` → one page reload.

**Adding a new string:**
1. Add the key to `dashboard/i18n.js` — **both `th` and `en` blocks** (missing one side = silent fallback)
2. Static markup → `data-i18n` / `data-i18n-html` / `data-i18n-ph` / `data-i18n-title`
3. JS dynamic → `I18N.t('key', fallback)`
4. New datetime input → register its id in the `_DT_*_IDS` registry too (GOTCHAS #64, #65)

**Check for leaked strings:**
```bash
grep -rn '[฀-๿]' dashboard/index.html dashboard/dashboard.js | grep -v 'data-i18n'
```

**Report exports:** analytics report is always Thai (Puppeteer runs in a fresh context with no language setting). Health report follows the selected language (`HR_LABELS.{th,en}` dict in `report-renderer.js`).

---

## 9. Camera Offline Alerts (Ph.1)

LINE notification when a camera drops off the heartbeat — configured per camera. Detailed delivery/recipient behavior lives in `docs/LOGIC_line-notifications.md`.

Settings → Camera Settings → edit camera → "Camera Offline Alerts" section:

| Field | Default | Notes |
|---|---|---|
| `enabled` | false | Enable/disable alert per camera |
| `notify_after_sec` | 300 | Seconds offline before first notification |
| `escalate_interval_min` | 60 | Repeat alert every N minutes while still offline |
| `escalate_once` | false | Check "Alert once only" — hides the interval field |
| `quiet_from` / `quiet_to` | NULL | Quiet hours (HH:MM) |

Status Log: Settings → Camera Settings → "Status Log" tab → all online↔offline transitions for the last 90 days.

A recovery alert is sent once when the camera comes back online (includes timestamp + offline duration).

---

## 10. Report History (Ph.2)

Every report delivery (scheduled and manual) is recorded in the `report_history` table.

**Access:** Settings → 🔔 LINE → Report History tab → paginated table.

| Button | Action |
|---|---|
| ▶ Run Now | Fire that schedule immediately (async — result appears in history when complete) |
| ⬇ PNG | Download the image file |
| ⬇ Export CSV | Last 200 rows |

**Retention:** rows kept 90 days; PNG files kept 30 days.

---

## 11. System Health Report (Ph.3)

Reports tab → dropdown → **🏥 System Health Report**

4 toggleable sections: cameras, alerts, storage, system.

| Button | Action |
|---|---|
| 👁 Preview | Render PNG inline |
| 📄 Download PDF | A4 + page numbers (Puppeteer) |
| 📥 Download PNG | 720px-wide (LINE-friendly) |
| 📤 Send to LINE | Admin — sends to selected recipients, logs to report_history |

Range picker: 24h / 7d / 30d / custom.

Offline camera row shows: date added to system + latest heartbeat timestamp + latest frame (from `events.has_snapshot` / `snapshot_filename`; `raw_json->>'_snapshot'` remains a legacy fallback).

Warning banners: offline >50%, disk >85%, RAM >85%.

---

## 12. Auditor role (read-only)

`auditor` — can view all pages, but POST/PUT/DELETE/PATCH are blocked server-side with 403 `read_only`.

Create: Settings → Users → "+ Add User" → role = `auditor`.

Auditor can see: all pages including Settings, Health Check, Audit Log, Report History.
Auditor cannot: change config, settings, or add/delete any data.

Camera Audit Log core (migration 024):
- `audit_log.target_camera_id` filters audit events by camera
- Records add/edit/delete camera, offline-alert settings, and group assignment/removal
- Camera audit details redact `username` / `password`
- UI: History → Audit Log → filter by Action + Camera

---

## 13. License operator notes (Phase 8)

View status: Settings → 🔐 License.

| Status | Effect |
|---|---|
| `ACTIVE` | Normal operation |
| `WARN_30D` / `WARN_7D` | Yellow warning banner |
| `GRACE` | Read-only for 7 days + red banner |
| `EXPIRED` / `TRIAL_EXPIRED` | Hard read-only |
| `INVALID` | Writes blocked |

**Activate:** Settings → 🔐 License → paste JWT → save → verified within 60 seconds (cache).

**Force re-check:** restart api-server or click "🔄 Refresh license".

> License JWT is stored in `system_settings.license_key` (DB) — not in a file. See `docs/LOGIC_license.md` for full rationale.

---

## 14. Dahua snapshot notes

Dahua VCA events use `src/ingesters/dahua-cgi.js` via the eventManager CGI.
Dahua snapshots do not rely primarily on `snapshot.cgi` because it is slow and often misses fast-moving subjects.

Current snapshot flow:

1. Use `snapManager` event JPEG if the camera includes one
2. If unavailable, use RTSP rolling buffer burst scoring around the server receive time
3. If the first pass is `low_confidence` / `missing` / `failed`, or the status has not been written by the time `clip_done` fires, the clip resolver retries and selects a frame from `media/<eventId>.mp4`
4. Single RTSP fallback and live CGI fallback are treated as `low_confidence` so the clip resolver can continue

Inspect results:

```sql
SELECT
  id,
  camera_id,
  event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  raw_json->>'_snapshot_source' AS source,
  raw_json->>'_snapshot_status' AS status,
  raw_json->'_snapshot_debug'->>'confidence' AS confidence
FROM events
WHERE camera_id IN ('DAHUA_CAM01', 'BMA-EAST_DAHUA_CAM01')
ORDER BY event_time DESC
LIMIT 20;
```

If `BMA-EAST_DAHUA_CAM01` is still missing frames, read `DahuaProblem.MD` before touching code.
Expected statuses after the fix: `dahua-clip-resolver / ok` or
`dahua-rtsp-buffer-best / ok`. `missing` typically means clip/buffer failed.

---

## 15. Camera Pause

Temporarily stop receiving events and alerts from a camera without removing it from the system. Suitable for maintenance work or temporary area shutdowns.

**Enable:** Settings → Camera Settings → select camera → toggle "Pause"

| Behavior | Detail |
|---|---|
| MQTT ingest | `mqtt-subscriber.js` drops events from paused cameras (no new rows in `events`) |
| Snapshot capture | Disabled (no images saved) |
| LINE alerts | Disabled (offline alerts and event alerts are not sent) |
| Heartbeat tracking | Still active — camera continues to count as online/offline normally |
| Dashboard feed | New events do not appear while paused |
| Audit log | Pause/resume recorded with timestamp and the admin who acted |

**Resume:** toggle back — events that occurred during the pause are permanently lost (no backfill).

---

## 16. Runtime Stack Reference

Quick reference for ops / troubleshooting — current versions as of v1.5.3

| Component | Version | Notes |
|---|---|---|
| Node.js | v22.22.3 LTS | EOL Apr 2027; `.zshrc` + launchd plist point to `node@22` |
| PM2 | 7.0.1 | 7 workers; config: `ecosystem.config.js` |
| EMQX | 5.8.9 | Port `0.0.0.0:1883` (AUTHN on); Dashboard `127.0.0.1:18083` |
| PostgreSQL | 16.14 | `127.0.0.1:5432`; data: `vigil_postgres_data` volume |
| Puppeteer | 25.1.0 | Chrome 149.0.7827.22 (bundled, `~/.cache/puppeteer`) |
| npm packages | 278 total | `npm audit`: 0 vulnerabilities (checked 2026-06-07) |

**PM2 quick commands:**

```bash
pm2 list                            # status of all workers
pm2 logs <name> --lines 50          # recent logs
pm2 restart ecosystem.config.js     # rolling restart all workers
pm2 env 0                           # show node_version used by worker
pm2 save                            # persist list → launchd resurrect on reboot
```

**services.sh wrapper** (equivalent to pm2 but wraps ecosystem.config.js):

```bash
scripts/services.sh start           # pm2 start ecosystem.config.js
scripts/services.sh restart         # pm2 restart ecosystem.config.js
scripts/services.sh stop            # pm2 stop ecosystem.config.js
```

**npm test** (run from project root `~/vigil-platform`):

```bash
npm test
# → node --test test/*.test.js   (43 tests: color-utils, crypto-creds, helpers, alert-engine)
```

**Docker quick commands:**

```bash
docker ps                           # container status
docker exec vigil-emqx emqx ctl status    # EMQX version + node
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c "SELECT version();"
```

**Latest CVE audit:** 2026-06-07 — 0 confirmed CVE; details in `public/others/vigil-docs-v2/05-security.html`

---

<sub>**SKILL.md** v1.5.3 — slim core · Detailed content in `docs/REF_*` · Vigil Platform · Updated 2026-06-08</sub>
