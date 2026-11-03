# SKILL.md — Vigil Platform Operations

> Operator's core playbook: mental model, mapping recipes, branding,
> health check overview, and feature summaries.
>
> **Troubleshooting steps** → `docs/REF_troubleshooting.md`
> **SQL snippets + service commands** → `docs/REF_operator-sql.md`
> **Design rationale** → `docs/LOGIC_*.md` files
>
> Last updated: 2026-09-06 · v1.5.4

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
17. [File Service](#17-file-service--sharing-files-with-customers)
18. [Storage management page](#18-storage-management-page)
19. [Reading list-page counts and defaults](#19-reading-list-page-counts-and-defaults)

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

### 2.1 Rule (IVA task) name — 64-byte limit

Bosch stores each IVA task (rule) name capped at **64 bytes**, UTF-8 encoded,
and cuts it mid-character if a name goes over — a Thai rule name is 3 bytes
per character, so this bites well before 64 Thai characters (about 21). The
MQTT topic for that rule's events embeds the name (`.../RuleEngine/
CountAggregation/Counter/&1/<name>`), so a name cut into invalid UTF-8 makes
the broker either silently drop every event on that topic (NanoMQ) or
disconnect the camera outright ("malformed packet", Mosquitto 2.x). A name
containing `+` or `#` is also illegal in an MQTT topic segment and has the
same effect.

- **How to see it:** Health › Devices — a Bosch camera with an affected rule
  shows a `ชื่อกฎใช้ไม่ได้ N` / `N rule name(s) unusable` warning chip; hover
  it for which rule and why. Checked hourly (both edge and central, read-only).
- **Fix:** rename the offending task on the camera itself (Bosch Configuration
  Manager or the camera's web UI) to something under 64 bytes with no `+`/`#`.
  Nothing in Vigil renames it automatically — this is detection only.
- Also surfaced as a short help line in Settings › Cameras, MQTT Credentials
  section, for Bosch cameras.

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
| 🗄️ Database | Postgres latency, total events, 1h/24h event rate. **The all-time totals (total / Face / LPR) are approximations** and render with a leading `≈` — full `count(*)` on 40M rows cost 40 s per page load, so total now comes from partition `reltuples` and the Face/LPR splits from the `event_dim_bucket` rollup (within ~0.35% at last check). The 1h and 24h numbers are still exact. No `≈` and a suspiciously round 0 means the query failed, not that the count is zero (decision #263) |
| 📡 MQTT Pipeline | Last event timestamp, age, status (`healthy`/`idle`/`stale`) |
| 📷 Cameras | online/offline counts (heartbeat <90s) |
| ⚙️ Service Processes | PM2 status per worker (`online`/`stopped`/`errored`); uptime; restart count `↺N` (yellow = has restarted). **8 tracked services**: api-server, mqtt-subscriber, media-recorder, hikvision, dahua, alert-worker, report-worker, lpr-receiver. All 8 have a **Restart** button; the other 7 additionally show **Stop** while running or **Start** while stopped — never both at once. api-server gets Restart only, because stopping it would brick the dashboard with no way back through the UI. `face-embed-worker` runs under PM2 as the 9th app but is not on this list — check it with `pm2 list`. The action allowlist and the status list are two separate constants in `src/routes/health.js` and must stay identical, or a button renders and then 400s |
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

Reports tab → 6 types: **Daily / Weekly / Monthly / Summary / Custom / 🏥 Health**. Five of those are schedulable (`REPORT_TYPES = ['daily','weekly','monthly','summary','health']`); **Custom is manual-only** — a schedule has no way to say "these two dates".

| Type | Range |
|---|---|
| Daily | 00:00–23:59 of selected date (display_timezone) |
| Weekly | Monday 00:00 – Sunday 23:59 |
| Monthly | First to last day of month |
| Summary | Three windows off one anchor date, on one page: the anchor day · the 7 days ending on the anchor (anchor−6 … anchor) · the whole calendar month containing the anchor. Scheduled, the anchor is yesterday |
| Custom | from+to, capped by `custom_range_max_days` |
| 🏥 Health | 24h/7d/30d/custom — see §11 |

**Scheduled delivery (Phase 7.3):** Settings → 🔔 LINE → Scheduled Delivery. Each schedule generates PNG → LINE via imgbb. `send_day_of_week` gates weekly; `send_days_of_month` gates monthly. Every fire logged to `report_history` — see §10. LINE delivery rules live in `docs/LOGIC_line-notifications.md`.

**Monthly means the previous calendar month** (1st to end of month), changed 2026-09-03 at the owner's request — a report sent on 1 September covers all of August. It used to be a rolling 30 days. Manual monthly reports prefill the previous month to match. Daily and weekly are still rolling windows ending at today 00:00. (decision #269)

**Report options** — set per schedule (`section_config`) or from the report page for a manual export:

| Option | Effect |
|---|---|
| Section toggles | Turn individual KPI blocks and sections off; the saved default is "show everything", so an old schedule renders exactly as before |
| Donut percentages | On by default; turn off to show counts only |
| Per-day time window | `tod_from` / `tod_to` — HH:MM on 30-minute steps, `from` before `to`, validated server-side. The window is printed in the report header, otherwise a filtered figure reads like a whole-day total |
| Daily bars split by category | The per-day bar chart stacks by event category instead of one flat total |
| Category donut merges IN/OUT | The overview donut counts a category's IN and OUT as one slice — direction is not a type, and 8 thin slices read as noise. The category *table* next to it still lists them separately. Sites that do not name cameras IN/OUT are unaffected |

**Analytics report export:** click Export PDF → Puppeteer renders A4 PDF (Thai fonts, text selectable). Since 2026-09-06 the render happens **inside report-worker**, not api-server — one Chromium for the whole box instead of two. If report-worker is down or busy the download still works, it just falls back to rendering in-process (up to 120 s wait first). `REPORT_RENDER_VIA_WORKER=0` forces the old in-process behaviour.

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
grep -rn '[฀-๿]' dashboard/index.html dashboard/dashboard.js dashboard/page-*.js | grep -v 'data-i18n'
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

**Pure helper modules (testable in isolation):**
- `src/ingesters/dahua-protocol.js` — parser: `parseDahuaEventText`, `parseSnapManagerCode`, `extractObjectClass`, `DAHUA_EVENT_MAP`
- `src/ingesters/dahua-snapshot-selector.js` — scoring: `scoreFrameForObject`, `scoreFrameMotion`, `chooseBestSnapshotCandidate`, `selectScanSegments` + constants

Current snapshot waterfall (in order):

1. **snapManager event JPEG** — camera-embedded JPEG delivered alongside the event text (`dahua-event-snapshot`)
2. **RTSP buffer burst** — score 11 candidate frames around server receive time via motion-diff + ROI detail (`dahua-rtsp-buffer-best`); segment "closed" check uses mtime fallback (`SEGMENT_CLOSE_AGE_MS = 2000`) so sparse buffers still yield candidates
3. **RTSP buffer scan** — if burst returns 0 candidates, scan up to 5 closed segments within ±30 s of event time, score each, pick best (`dahua-rtsp-buffer-scan`, `low_confidence`)
4. **Single RTSP fallback** — dumb single frame at the computed target timestamp, no scoring (`dahua-rtsp-buffer`, `low_confidence`)
5. **CGI live** — last resort; always late relative to the event (`dahua-cgi-live`, `low_confidence`)

Steps 3–5 are all marked `low_confidence` so the clip resolver continues to upgrade them when `clip_done` fires. The clip resolver selects the best frame from `media/<eventId>.mp4` and promotes status to `ok`.

Inspect results:

```sql
SELECT
  id,
  camera_id,
  event_time AT TIME ZONE 'Asia/Bangkok' AS local_time,
  raw_json->>'_snapshot_source' AS source,
  raw_json->>'_snapshot_status' AS status,
  raw_json->'_snapshot_debug'->>'confidence' AS confidence,
  raw_json->'_snapshot_debug'->>'strategy' AS strategy
FROM events
WHERE camera_id IN ('DAHUA_CAM01', 'BMA-EAST_DAHUA_CAM01')
ORDER BY event_time DESC
LIMIT 20;
```

Expected statuses: `dahua-clip-resolver / ok` (best), `dahua-rtsp-buffer-best / ok` (burst hit).
`dahua-rtsp-buffer-scan / low_confidence` = scan fallback fired (burst found 0 candidates — usually right after camera reconnect).
`missing` = clip + all buffer paths failed.

If `BMA-EAST_DAHUA_CAM01` is still missing frames, read `DahuaProblem.MD` before touching code.

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

Quick reference for ops / troubleshooting — current versions as of v1.5.4

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

## 17. File Service — sharing files with customers

Our own file host, so documents and images can be sent to customers without an
outside service. You get a signed, expiring link to paste into an email or LINE.

**Where:** **System → File Service** in the sidebar (admin only)

| Item | Detail |
|---|---|
| Accepted types | **png · jpg · pdf · docx · xlsx** only |
| Size limit | 25 MB per file (over that returns a readable message, not an error page) |
| How files are checked | **Magic bytes** of the real content. The extension and the browser's Content-Type are both ignored |
| File age | Set per file (1–3650 days). Leave blank to use `file_retention_days` (default 90) |
| Link format | `https://upl.dojojin.tech/pub/fil/<uuid>.<ext>?exp=...&sig=...` |
| Revoke | Press "Revoke" — **the file is deleted from disk immediately** and links already sent stop working (410) |
| On expiry | The daily sweep deletes the file from disk. The row stays for the audit trail |

> **Magic bytes** are the first few bytes that identify what a file really is. An
> HTML file named `.jpg` is rejected because its content is not an image.

**Why a separate hostname (`upl.dojojin.tech`)** — files that people upload should
not sit on the same origin that carries the dashboard's session cookie. That
hostname serves `/pub/fil/*` and nothing else: `/index.html` and
`/api/auth/login` both return **404** there.

**A limit worth knowing:** `docx` and `xlsx` are both zip containers, so magic
bytes can only prove "this is a zip". The extension picks the label between the
two, which means a plain zip named `.docx` will be accepted. It is not dangerous:
every file is served as an `attachment` (download only, never rendered) from a
hostname that holds none of our cookies, so the recipient simply cannot open it.

---

## 18. Storage management page

Shows where disk space went and lets you delete old files by hand, for the
central machine and for every edge site.

**Where:** **Health Check → "Storage" tab** (admin only). Pick a machine with the
buttons at the top (`Central` / `hdy` / `hkt` / `rmutr-v` / `vss`).

| Section | What it is for |
|---|---|
| Disk | percent used, GB free, GB total |
| Retention per category | Set file age and link age per category, then "Save retention" |
| Manual delete by age | Pick a category and a number of days → **"Check first"** shows the file count and size before you confirm |
| Category table | size, file count, files with no owner, oldest file, when it was measured |
| "Measure now" | Runs a fresh scan. Edge machines are asked over MQTT and can take up to 60 seconds |

> The table shows the result of a **scan**, not a live value — always read the
> "Measured" column with it. Sizes are the space actually **allocated on disk**,
> which can be twice the sum of the file sizes when there are many small files
> (the apparent total is shown underneath for comparison).

**Manual deletion is by file age only**, the same rule the automatic sweep uses.
**Deleting "files with no owner" is deliberately not offered**: about 2.5% of
events never recorded a filename, so their images look ownerless while still
being evidence.

**Retention is set on Central only** and pushed to every edge over MQTT. Opening
an edge tab shows the values read-only; change them on `Central`.

---

## 19. Reading list-page counts and defaults

Two behaviours that look like bugs and are not.

### LPR "ไม่ทราบทะเบียน" (no-read) tab defaults to the last 24 hours

Opening the tab with no date range set does not scan all history — the server applies a 24-hour default and the page writes that range back into the date boxes so you can see what you are actually looking at. The **week** and **month** quick buttons are now usable: no-read is defined as `raw_json->>'plate'` being empty and there is a partial index on exactly that predicate (migration 199), so the wider ranges no longer fall back to a full scan. A weekly self-check re-verifies that the index predicate and the definition still agree — if they ever drift, it shows up in the api-server log as `lpr.noread_check`. (decision #265)

### A count of "10,000+" means the server stopped counting

Events, Snapshots, Media and Appearances stop counting matches at 10,000 (`EVENTS_COUNT_CAP`). When the cap is hit the response carries `X-Total-Capped: 1` and the page shows **10,000+** rather than presenting the floor as a total. Paging still works past it; only the total is capped. Counting the real total meant scanning the whole 40M-row `events` table even for a 50-row page, which is what made these pages slow. Narrow the filter — a camera, a shorter range — and the exact number comes back. (decision #264)

---
---

<sub>**SKILL.md** v1.5.4 — slim core · Detailed content in `docs/REF_*` · Vigil Platform · Updated 2026-09-06</sub>

## 20. LINE commands — asking the system from the group chat

Operators type an ordinary Thai sentence into a LINE group the bot is in and get a
card back. Nothing has to be prefixed and the bot is never @-mentioned.

**Who can command.** Only people listed under Settings › LINE / การแจ้งเตือน ›
คำสั่งผ่าน LINE › ผู้มีสิทธิ์สั่ง. Everyone else is answered with silence — the
attempt is still written to the usage log. Each operator is bound to one system
account, and **that account decides what they can ask**: an account that only sees
four cameras in Phuket gets the total of those four, and the card says so
("ภูเก็ต (4 จาก 86 กล้อง)"). Prefer a purpose-made viewer account over an admin one.

**Adding an operator.** Have the person post anything once in a group the bot is in,
then pick their name from the dropdown on that tab — the list is built from people
who messaged the bot and people seen typing in those groups, with their LINE display
name resolved for you. Then choose the account they borrow.

**What can be asked** (13 commands, all editable on that tab)

| Ask | Example |
|---|---|
| Helmet violations | `ขอทราบยอดคนไม่สวมหมวกนิรภัย ภูเก็ต ชั่วโมงที่แล้ว` |
| Top offending plates | `ขอป้ายทะเบียนที่ฝ่าฝืน เยอะที่สุดมา 3 ป้าย` |
| Plates read / unread | `ยอดอ่านป้ายทะเบียนวันนี้` |
| Plates from one province | `สรุปจำนวนป้ายทะเบียน จังหวัดยะลา ที่หาดใหญ่ เมื่อวาน` |
| Watch-list hits | `วันนี้เจอรถเฝ้าระวังคันไหนบ้าง` |
| One plate's history | `ป้าย 1กอ88 เจอที่ไหนบ้าง 7 วัน` |
| Photos of one plate | `ขอรูปรถป้าย 1กอ88 วันนี้ทั้งหมด` |
| Vehicles by type (plate-reading cameras) | `ขอจำนวนรถแยกประเภท ภูเก็ต วันนี้` |
| Event categories (analytics cameras, per site) | `ขอหมวดเหตุการณ์ RMUTR-V วันนี้` |
| One category only | `ขอหมวดเหตุการณ์ RMUTR-V เมื่อวาน เฉพาะ รถจักรยานยนต์` |
| Photos from analytics cameras | `ขอรูปรถบรรทุก RMUTR-V เมื่อวาน 18:00-19:00` |
| Photos of one tracked object | `ขอรูปวัตถุ 121766 เมื่อวาน 18:00-19:00` |
| Smart search (Phuket only) | `ค้นหาอัจฉริยะ คนถือร่ม เมื่อวานตอนบ่ายโมง` |
| Face search by description | `ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง เมื่อวานตอนเช้า` |
| Count by object type | `สรุปจำนวนรถจักรยานยนต์ เมื่อวานก่อนเที่ยง กล้องฉัตรไชย ทั้งหมด` |
| Every object type at once | `สรุปชนิดวัตถุ ภูเก็ต เมื่อวาน` |
| Camera status on HikCentral | `สรุปสถานะกล้องบน HCP เฉพาะที่ดับ` |
| Cameras offline | `ตอนนี้กล้องดับกี่ตัว` |
| Everything available, with examples | `ช่วยเหลือ` |

Any of them takes a period (`ชั่วโมงที่แล้ว`, `วันนี้`, `เมื่อวาน`, `7 วัน`,
`เดือนที่แล้ว`, `1 ก.ย.`), a site by Thai name, and most take a camera by name or by
the code in its brackets (`กล้อง C20`). Leave the period out and it means today; the
card always prints back the period and scope it used, so a wrong reading is visible.

**Two ways to count vehicles, and they never agree.** A site can carry both kinds of
camera. RMUTR-V does: the Bosch units count line crossings (one vehicle in and out is
two crossings) and the Dahua ANPR counts plates it managed to read. On 8 Sep that was
12,273 crossings against 7,248 vehicles for the same day. Neither is wrong, they answer
different questions, so every counting card prints which kind of camera it came from.
Event categories are set per site (RMUTR-V counts vehicles, VSS counts people at doors),
so that command always asks which site if the account can see more than one.

**Clock ranges now work.** `เมื่อวาน 18:00-19:00`, `8-12 น.`, `ตอน 18 โมง` narrow the
answer to those hours. Before this they were read as the whole day without saying so.
A multi-day span plus a clock range is still answered as whole days, and the card says
so rather than staying quiet about it.

**On asking for "this vehicle".** A photo request finds vehicles of that *type* in that
window, and the object code on the event detail screen finds every frame of that one
pass. It cannot follow the same vehicle across days or cameras: the object code is a
track number the camera resets each time, and the analytics cameras do not read plates.
Searching by object code looks at one day at a time, so give it the day.

**Smart search from chat.** `ค้นหาอัจฉริยะ คนถือร่ม เมื่อวานตอนบ่ายโมง` runs the same
search as the Smart Search page and answers with how many were found, which cameras they
came from, and the English phrase actually sent to the engine. It takes about 25 seconds,
so the answer arrives a little after the others. Three things to know: the search engine
lives in Phuket and nothing else is connected to it, so the card always says ภูเก็ต; the
per-camera counts come from the 30 most recent hits, not from the whole total; and the
card repeats the warnings the page shows, including words the translator does not know.
Ranking is similarity, not correctness, so open the page and look at the pictures before
concluding anything.

The bot says "กำลังค้น…" first and sends the results when they arrive, with up to ten
pictures attached.

**Face search from chat.** `ค้นหาใบหน้า ผู้หญิง ใส่เสื้อสีแดง เมื่อวานตอนเช้า` runs the same
search as the Face Data page and comes back with up to ten face crops, each captioned with
the time, the camera, and what the camera saw (sex, age band, mask, hat, glasses). It reads
sex, age band, mask, hat, glasses, expression, shirt and trousers colour, and sleeve type.
"Not wearing" beats "wearing", so `ไม่สวมหน้ากาก` filters the opposite way from `สวมหน้ากาก`.
A colour has to be attached to a garment: `เสื้อสีแดง` works, a bare `สีแดง` is ignored
rather than guessed. The card always prints the conditions it used, so a misreading is
visible immediately.

**Times can now be spoken the way people say them** in every command: `ตีหนึ่ง`,
`บ่ายสองโมง`, `สามทุ่ม`, `เที่ยง`, `ตอนเช้า`, `ช่วงบ่าย`, `กลางคืน`. A specific hour always
wins over a part of the day. Note that `ตอนเช้า` typed at two in the morning means this
morning, which has not happened yet, and the card says so instead of answering zero.

**Naming a group of cameras.** Cameras are often several at one place, so a partial name
works and `ทั้งหมด` after it takes all of them: `กล้องฉัตรไชย ทั้งหมด` covers all six there.
Leave `ทั้งหมด` out and the bot lists them and asks which one, and `ทั้งหมด` is a valid
answer to that question too. Every card prints the scope it used, including
"ทุกไซต์ที่ดูได้" when no site was named, so an answer that is wider than intended is
visible rather than silent.

**`ช่วยเหลือ` now lists every command with a working example under it**, split into
"ask" and "do", and ends with the time words and scope words you can append. The examples
live in the settings tab next to each command, so when you add a command you write the
example people will see.

**Two different camera-status answers, on purpose.** `กล้องดับ` counts from the events
flowing into this system; `สถานะกล้องบน HCP` reports what HikCentral itself sees, which
includes cameras only HikCentral manages. The two numbers are not meant to match, and each
card says which one it is. The HCP one is Phuket-only and needs an admin account.

**What can be done** (not just asked)

| Do | Example | Note |
|---|---|---|
| Escalate an alert to another group | `ส่งให้ตำรวจ 1กอ88` | asks to confirm first; sending cannot be undone |
| Acknowledge | `รับทราบแจ้งเตือน 1กอ88` | no confirmation needed |
| Silence one plate | `หยุดแจ้งเตือน 1กอ88 3 ชั่วโมง` | **always expires** — 24 h by default, 7 days maximum |
| Un-silence | `เปิดแจ้งเตือน 1กอ88` | reports the real state, e.g. "but that group is muted" |

A permanent silence is a dashboard action on purpose: a muted card can be a stolen
vehicle with a police contact on it, and a mute set from chat and forgotten is damage
nobody notices.

**When the bot does not understand.** The usage log on the same tab marks those lines
"จับไม่ได้" — they are the sentences no trigger word covers yet. Add the word to the
command in the form beside it. Two commands fighting over the same sentence is solved
with "คำที่ต้องมีครบ" on one and "คำที่ห้ามมี" on the other.

Full architecture, tables and incident log: `docs/LOGIC_line-commands.md`.
