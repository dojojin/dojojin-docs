# 🛡️ Vigil Platform

> **CCTV Analytics & Management Suite** — Real-time, multi-vendor video analytics platform for Bosch, Hikvision, Dahua, and generic ONVIF cameras.

[![Version](https://img.shields.io/badge/version-1.5.3-blue.svg)]()
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)]()
[![Status](https://img.shields.io/badge/status-Production-green.svg)]()
[![Multi--vendor](https://img.shields.io/badge/Multi--vendor-Bosch%20%C2%B7%20Hikvision%20%C2%B7%20Dahua%20%C2%B7%20ONVIF-success.svg)]()
[![Licensing](https://img.shields.io/badge/Licensing-Ed25519%20JWT-success.svg)]()
[![White--label](https://img.shields.io/badge/White--label-Ready-orange.svg)]()

> Live (developer): [`https://dashboard.dojojin.tech`](https://dashboard.dojojin.tech)
> 🇹🇭 ภาษาไทย: [`README-TH.md`](README-TH.md)

---

## 📋 About

**Vigil Platform** is a comprehensive multi-vendor CCTV analytics platform by **DojoJin Tech**. It ingests events from **Bosch** (MQTT / ONVIF Profile M), **Hikvision** (ISAPI Alert Stream — Smart Events + Face Capture), and **Dahua** (CGI VCA events — Line Crossing, Intrusion, Smart Motion), with monitor-only support for **generic ONVIF** cameras — providing real-time monitoring, intelligent LINE alerts, branded reports, demographic face analytics, and operational dashboards for security operations teams. Production deployments are protected by a machine-bound Ed25519 license.

## 🌟 Features

### 📷 Multi-vendor Camera Support — **v1.5 (Phase MV)**
One dashboard, four camera ecosystems — added behind a clean ingester architecture so the alert engine, stats, reports, and UI need **zero vendor-specific code**:
- **Bosch** — MQTT events (ONVIF Profile M), IVA Pro / IVA Basic
- **Hikvision** — ISAPI Alert Stream (long-lived multipart/mixed HTTP push): Smart Events (line crossing, intrusion, region entrance) **and Face Capture**
- **Dahua** — CGI VCA events (Line Crossing, Intrusion, Smart Motion via `eventManager.cgi`); pre-alarm RTSP clips; snapshot extraction
- **Generic ONVIF** — monitor-only (live view + online status via TCP-reachability probe)
- **Full-page Camera Settings** (`⚙️ ตั้งค่ากล้อง`) — vendor-adaptive add/edit form, colour-coded vendor badges, per-camera RTSP/snapshot stream selection, inline validation, Test Connection, Live Snapshot Preview
- **EMQX auto-provisioning** — saving a Bosch camera auto-creates a per-camera MQTT user; credentials appear in the edit form immediately
- `cameras-config.json` carries a first-class `vendor` field; every vendor's events normalise into the **shared `events` table**

### 🛡️ Security Morning Briefing — **default page (v1.5)**
Operational overview designed for the **Security Manager** persona — answers three questions in 3 seconds:
- **Status Strip** — `N/total cams online · MQTT live · XX% disk · up Xd` (green / amber / red)
- **Attention** — alerts from the last 4h with `rule_name` + snapshot thumbnail / offline cameras with duration
- **Activity 24H** — events/hour bar chart + Today vs Yesterday KPIs (`Events +12% ↑ · Alerts −34% ↓`)
- **Site Map** (compact + heatmap) + **Top Hotspots** (top 5 cameras by event count)
- **Footer** — `version · uptime · snapshot count · clip count · backup status`

### 💓 System Health Report — **v1.5 (Ph.3)**
Full health reporting for Security Operations teams:
- **5 toggleable sections**: Camera Status, Camera Uptime, Alerts, Storage, System
- **3 output formats**: Preview (PNG inline), Download PNG, PDF (A4 + page numbers via Puppeteer)
- **Send to LINE Now** — admin-gated, per-recipient checklist
- Range picker (24h / 7d / 30d / custom) for uptime % and alert counts
- Warning banners auto-fire: offline > 50% / disk > 85% / RAM > 85%
- Schedulable just like analytics reports (day-of-week gate)
- PNG rendering via SVG + `sharp` (no Puppeteer dependency for image path)

### 🔔 Camera Offline Alerts — **v1.5 (Ph.1)**
- Detects camera offline transitions (heartbeat threshold 90s) and fires LINE alerts
- Per-camera LINE recipient checklist (admin-approved recipients only)
- Configurable repeat interval + escalation; `escalate_once` flag for single-fire mode
- Quiet hours and recovery notifications
- **Status Log** — paginated timeline of online/offline transitions per camera (`camera_status_log`)

### 📜 History Workspace — **v1.5 (Ph.6)**
Consolidated "ประวัติและบันทึก" sidebar section:
- **Alert Logs** — with summary strip (sent / failed / skipped / LINE msgs) + window picker
- **Report History** — every scheduled and manual send logged; PNG download per row; success-rate breakdown
- **Camera Status Log** — heartbeat-based transition timeline
- **Audit Log** — all admin actions including camera add/edit/delete, group assignment, credential changes
- **Active Sessions** — view and revoke live sessions

### 📺 Live Monitoring
- Real-time camera status with heartbeat-based offline detection (90s threshold)
- Live snapshot proxy with multi-source fallback (MQTT base64 → HTTP)
- KPI dashboard (cameras online, recording, today's events — server-side, TZ-aware)
- Camera grouping (floor / building / area) with tab filters
- New-event **toast + nav badge** — incidents surface on any page (throttled burst coalescing)

### 🎯 Event Intelligence
- IVA Pro event ingestion (Crossing Line, Object In Field, Loitering, etc.)
- Object-class hierarchy: `Person` → Face/HumanBody/Pedestrian/…, `Vehicle` → Car/Truck/Bus/Motorbike/Bike
- Server-side pagination (20/page, no hard cap, `X-Total-Count` header)
- Server-side filters: search + camera + rule + class + tab (snap / clip / LPR) + date range

### 🙂 Face Capture — **v1.5 (Phase MV.3)**
Hikvision Face Capture cameras feed a dedicated **"ภาพใบหน้า" gallery** — deliberately separate from the incident feed:
- Binary-safe multipart parser extracts JSON event + face-crop JPEG + full-frame background
- Demographic attributes: age band (10-year buckets), gender, expression, mask / glasses / hat — Thai-labelled
- Filterable gallery + demographic summary bar
- Per-face detail modal: full-frame background + pre-alarm clip + attribute table

### 📋 License Plate Recognition (ANPR) — **v1.5.3**
Hikvision ITCCAM ANPR HTTP-push ingester feeds a dedicated **"ป้ายทะเบียน" gallery** with search, watchlist, and KPI:
- **Gallery tabs**: Latest (24h) · Search (text/camera/region/date) · Watchlist (flag plates → LINE alerts)
- **Plate search**: Text search, camera filter, geographic region (province), date range
- **Watchlist management**: Admin-gated flag/unflag, rules auto-fire alerts, per-recipient toggle
- **KPI dashboard**: Today total plates, unique plates, top brands (synthetic DLT plaque display)
- **Data persistence**: LPR events normalized into shared `license_plates` table (same retention policy as events)

### 🎥 Pre-alarm Video Clip Capture — **v1.2.1 (Phase 6.1)**
- 24/7 RTSP rolling buffer per camera (Stream 2 — ~1080p / 2 Mbps)
- Event triggers MP4 dump (configurable pre/post seconds); all three vendors supported
- Postgres `LISTEN/NOTIFY` decouples MQTT subscriber from media recorder (race-free)
- Per-camera toggles: clip / snapshot / VCA overlay

### 🗺️ Geographic Visualization
- Multi-provider map system (CartoDB + Mapbox — token stored in DB, hot-reload on save)
- **Multi-group color-coded overlay** — each camera group gets a distinct ring color; legend panel with per-group toggle
- **Live Pulse Toast-on-map** — per-camera debounce (5/15/30/60s), bump mode, max 6 concurrent cards, snapshot thumbnail
- **Wall Mode** — single-click full-screen video wall; Fullscreen API + CSS class toggle; persistent `localStorage`
- **FIT button** — recenter to visible cameras only
- Heatmap overlay with last 24h event density
- **Offline tile cache** with bbox selector + multi-area download manager
- Map Settings sub-tab — Mapbox token management, tile cache management

### 📱 Vigil Mobile — Companion App (iOS + Android)

Native companion app สำหรับ security ops ใช้บนมือถือ — ข้อมูล real-time เดียวกับ web dashboard ผ่าน REST + WebSocket เดิม ไม่มี backend แยก

| Feature | iOS | Android |
|---|---|---|
| **Auth** — Bearer token + SecureStore (Keychain / Keystore) | ✅ | ✅ |
| **Real-time WebSocket** — singleton, backoff reconnect, AppState pause/resume | ✅ | ✅ |
| **Cameras tab** — KPI · GroupFilter · search bar · status chips (All/Alert/Offline/Online) · density toggle (List/Grid) · 2-col grid · live snapshot | ✅ | ✅ |
| **Alerts tab** — real-time event feed จาก wsStore | ✅ | ✅ |
| **Events tab** — paginated · 4-segment (All/Snapshot/Clip/Face) · search · EventDetailModal · video playback · save image to album | ✅ | ✅ |
| **Stats tab** — per-category KPI · MultiLineChart (react-native-svg, tap tooltip + crosshair) · vendor filter · range picker | ✅ | ✅ |
| **Map tab** — WebView + MapLibre GL JS + CartoDB tile · pin online/offline · event badge · native bottom sheet + live snapshot | ✅ | ✅ |
| **Push notifications** — Expo Push Token · per-rule `push_user_ids` · 3-layer filter (rule / 20s cooldown / device-toggle) · Alert + Face sub-toggles | ✅ | ✅ (dev build) |
| **Biometric login** — Face ID / Fingerprint (background→active re-auth) | ✅ | ✅ |
| **Custom server URL** — white-label multi-deployment; login screen ⚙️ → URL setup | ✅ | ✅ |
| **Settings** — push toggles · theme auto/light/dark · logout | ✅ | ✅ |
| **i18n Thai / English** — reactive language switch | ✅ | ✅ |
| **iPad / Tablet** — two-pane split layout (Camera tab) | ✅ | ✅ |
| **Camera scale** — 100–3,000 cameras optimized (lazy snapshot · FlatList windowing · priority sort alert > offline > online) | ✅ | ✅ |

**UI/UX Assessment:** ~90/100 — เทียบเท่า UniFi Protect ในด้าน feature · haptic + skeleton + swipe-to-dismiss + tab transitions

**Tech:** React Native 0.81 · Expo SDK 54 · Expo Router v6 · Zustand v5 · TypeScript strict · `expo-image` · `expo-video` · `react-native-svg`
**Repo:** [`github.com/dojojin/vigil-mobile`](https://github.com/dojojin/vigil-mobile)

### 🔔 LINE Notification System
- Per-rule alert configuration (camera + rule_name multi-select)
- Multi-recipient (User + Group) support with **self-service onboarding** (QR code, OA Basic ID, webhook auto-reply)
- Pending recipient approval, block list, LINE Push Quota widget
- Cooldown (default 60s) + audit log + 6 status types
- Per-rule **quiet hours**; placeholders: `{camera}`, `{location}`, `{camera_id}`, `{rule}`, `{time}`

### 📊 Analytics — **Stats v2** + **Density** (v1.3)
- **Per-category KPI cards** with rolling comparison
- Custom date-range picker (5 quick presets aligned to calendar boundaries)
- Event Overview chart, Distribution pie, per-camera bar charts
- **Activity Heatmap** — hour × day-of-week matrix with category filter
- **Live People-in-Area** — Bosch CountAggregation + 2s median smoothing → WS push
- **Density Over Time** + **Density Heatmap** (amber palette)
- Top Rules / Quiet Cameras + CSV export + Drill-down click
- Configurable categories — admin-defined with custom icon/color

### 📄 Reports — **Phase 7.3**
- 4 report types — Daily / Weekly / Monthly / Custom (rolling last-N-days)
- Single shared template (`report-template.js`) — drives interactive preview AND Puppeteer print page
- **PDF export** via Puppeteer (A4 + page numbers); PNG via SVG+sharp for Health Report
- **Scheduled delivery to LINE** — frequency / send time / recipients / layout (compact or full)
- Branded header & footer — auto-pulls customer logo + name + accent color
- **Report History** — every attempt logged; 90-day row retention; 30-day PNG retention; CSV export

### 🔕 Per-rule Quiet Hours — **v1.3 (Phase 7.2)**
- Per `alert_rule` quiet window (TIME columns, NULL = always fire)
- Crosses-midnight supported (e.g. 22:00–06:00); display-timezone aware

### 💓 Health Check page
Admin-only page auto-refreshing every 15s:
- DB latency + total events + 1h/24h rates
- MQTT pipeline freshness + Camera online/offline counts
- Snapshot count + size, disk free/total
- Process uptime, RSS/heap memory, WebSocket clients, hostname, load avg
- **Camera Image Quality (24h)** — bright/dark/blurry/scene-change counts per camera

### 🧹 Configurable Retention
Three daily background jobs:
- `data_retention_days` (1–730, default 365) — deletes old `events` rows
- `snapshot_retention_days` (1–365, default 30) — unlinks old snapshots
- `clip_retention_days` (1–90, default 30) — unlinks old MP4 clips

### 🗃️ Schema Migrations + Backup/Restore — **v1.2.1 (Phase 6.1.10)**
- `src/migrate.js` — runs at api-server boot, scans `db/db_migration_*.sql`, applies pending in transactions
- `npm run migrate` — manual ad-hoc run (CI / pre-deploy)
- `scripts/backup.sh` — daily `pg_dump -Fc -Z 6` via launchd (03:00), 14-day retention
- `scripts/restore.sh` — interactive `pg_restore --clean --if-exists`
- ⚠️ Never edit `init.sql` to evolve schema — write a new `db/db_migration_<NNN>_<topic>.sql` instead

### 📱 Mobile Responsive
- Hamburger button + sliding sidebar on screens ≤768px
- Stack 2-col grids (events / reports / modals)
- Touch-friendly inputs, full-screen modals, horizontal-scroll tables
- All pages tested on iPhone Safari + Android Chrome

### 🔐 User Authentication
- 3 roles: **Admin** (full access) / **Viewer** (read-only) / **Auditor** (read + audit access)
- bcrypt password hashing + HMAC-signed sessions (7 days)
- Brute force protection (5 fails → 15min lock + 10/min IP rate limit)
- Audit log retention 90 days; User CRUD + password reset
- Active session management with revoke; Force-change password on first login
- **Triple-layer auth** (Cookie + localStorage + URL hash) for Safari ITP compatibility

### 🔑 Licensing & EULA — **v1.5 (Phase 8)**
- **Machine-bound Ed25519 / JWT license** — offline-first, verified against embedded public key (`jose`)
- 7-day trial from first login → 7-day **read-only grace** after expiry → locked
- Tier-based camera-count enforcement (STARTER / STANDARD / PROFESSIONAL / ENTERPRISE / DATACENTER)
- In-UI activation, Machine ID display, keygen CLI (`scripts/keygen/`)
- Formal **Thai EULA** (`docs/EULA-th.md`) with blocking first-login acceptance flow

### ⚖️ Compliance & Legal
- Mandatory legal disclaimer page (re-acceptance per browser session)
- Computer Crime Act B.E. 2550 + PDPA-aligned data retention
- Activity logging for all auth events (90-day retention)
- All static assets + `/snapshots/*` + `/media/*` auth-gated (no public enumeration)

---

## ⚡ Performance Highlights

| Optimization | Before | After | Win |
|---|---|---|---|
| **Puppeteer browser pool** | Cold-launch Chromium per render (3–5s) | One process reused, fresh page per call | **~9× faster warm render** (1419ms → 159ms) |
| **WS `new_event` via LISTEN/NOTIFY** | 1s polling loop | Push via `pg_notify` from subscriber | **~86,400 DB queries/day saved** |
| **Config file mtime cache** | `readFileSync` on every request | Read disk only when mtime changes | Eliminates per-request disk block |
| **SD probe parallel** (`pollAllSdStatus`) | Serial `for...await` 20 cams = 80s | `Promise.all` batch=5 = 16s | Stays below 30s poll interval |
| **30s TTL cache** (`today-counts` + `exec-summary`) | ~15 parallel queries per poll | Single global slot, 30s TTL | Major reduction in DB load |
| **`pg_trgm` GIN index** on `event_type` | Leading-`%` LIKE bypasses b-tree | GIN index handles arbitrary LIKE | No query changes needed |
| **`package.json` strip** | 149 declared deps | 10 real direct deps | Clean install, 0 vulns |

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│       Multi-vendor Cameras — Bosch · Hikvision · Dahua          │
│  Bosch → MQTT  ·  Hikvision → ISAPI HTTP  ·  Dahua → CGI HTTP  │
└──────────────────┬────────────────────────┬────────────────────┘
                   │ MQTT (ONVIF Profile M) │ RTSP (Stream 2)
                   ▼                        ▼
        ┌──────────────────┐     ┌──────────────────────┐
        │ EMQX 5.8 Broker  │     │  media-recorder.js   │
        │   (Docker)       │     │ 24/7 rolling segments│
        └────────┬─────────┘     │  → media-buffer/     │
                 │               └──────────┬────────────┘
                 ▼                          │ LISTEN clip event
        ┌──────────────────────────┐        │
        │   mqtt-subscriber.js     │────────┘
        │ + ingesters/             │
        │   hikvision-isapi.js     │
        │   dahua-cgi.js           │
        │ - Event normalisation    │
        │ - Snapshot capture       │
        │ - pg_notify(new_event)   │
        │ - pg_notify(alert_event) │
        └────────────┬─────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│       PostgreSQL 16 (Docker) — Single source of truth           │
│  Camera & Events · Alert System · Reports · Auth               │
│  Stats v2 + Brand · Migrations · Push Tokens                   │
│  21 tables · 3 daily retention jobs · LISTEN/NOTIFY channels   │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│        api-server.js (Express + WebSocket)                      │
│  - Auth middleware · License enforcement                        │
│  - Migrations on boot (fail-fast on schema error)               │
│  - WebSocket bridge via Postgres LISTEN/NOTIFY                  │
│  + alert-worker (pg_notify alert_event → LINE) isolated PM2    │
│  + report-worker (scheduler 60s + Puppeteer) isolated PM2       │
└──────────────┬────────────────────────────┬────────────────────┘
               │                            │
               ▼                            ▼
    ┌─────────────────┐           ┌──────────────────┐
    │  Web Dashboard  │◄── HTTPS ─┤ Cloudflare Tunnel│
    │   (browser)     │           │  (production)    │
    │  SPA · 15+ pages│           └────────┬─────────┘
    └─────────────────┘                    │
                                           ▼
                               ┌──────────────────────┐
                               │   Vigil Mobile App   │
                               │  iOS + Android (RN)  │
                               │  REST + WebSocket    │
                               │  Push Notifications  │
                               └──────────────────────┘
```

> **Non-Bosch vendors** run their own ingester process that connects *out* to the camera, normalises events into the same `events` table, and fires the same `pg_notify` channels — so the alert engine, WebSocket bridge, stats, reports, and UI are entirely vendor-agnostic.

---

## 🚀 Quick Start

### Prerequisites
- macOS / Linux with Docker
- Node.js 22 LTS
- Cameras with MQTT / ISAPI / CGI enabled

### Installation

```bash
# 1. Clone (private repo)
git clone <repo-url> vigil-platform
cd vigil-platform

# 2. Configure environment
cp .env.example .env
nano .env    # set DB password, SESSION_SECRET, MAPBOX_TOKEN, etc.

# 3. Generate SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Start infrastructure
docker compose up -d    # PostgreSQL 16 + EMQX 5.8

# 5. Initialize database
docker exec -i vigil-postgres psql -U vigil_sql -d vigil_platform < db/init.sql

# Verify (should show 14+ base tables)
docker exec -it vigil-postgres psql -U vigil_sql -d vigil_platform -c "\dt"

# 6. Install dependencies
cd src && npm ci

# 7. Run services (from repo root)
cd ~/vigil-platform && pm2 start ecosystem.config.js   # or ./scripts/services.sh start

# 8. Access
# → http://localhost:3000
# → Auto-redirect: /disclaimer.html → /login.html → /
# → Default admin: admin / changeme  (forced password change on first login)
```

📘 For day-to-day operations (start/stop/health check/troubleshoot), see [`service_start.md`](service_start.md).

### 🔄 Migration from an Older Version

```bash
# 1. Backup first!
./scripts/backup.sh

# 2. Schema migrations run automatically at api-server boot:
pm2 start ecosystem.config.js
#   → migrate.js scans db/db_migration_*.sql
#   → applies any not in `schema_migrations` table
#   → fail-fast if any migration errors (no partial schema)

# Manual run (CI / pre-deploy):
cd src && npm run migrate
```

### 💾 Backup / Restore

```bash
# Install daily auto-backup (one-time)
cp scripts/com.dojojin.dashboard.backup.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.dojojin.dashboard.backup.plist

# Manual backup
./scripts/backup.sh

# Restore (interactive, requires 'yes' confirmation)
./scripts/restore.sh backups/vigil_platform_2026-05-29_030000.dump
```

### Production Deployment

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create vigil-platform
cloudflared tunnel route dns vigil-platform dashboard.yourdomain.com
# Configure ingress in ~/.cloudflared/config.yml
cloudflared tunnel run vigil-platform

# Or install as a system service (auto-start on reboot):
sudo cloudflared service install <token>
```

---

## 🌐 Browser Compatibility

| Browser | Status | Auth Method |
|---------|--------|-------------|
| Chrome / Edge | ✅ Full | Cookie + Bearer |
| Firefox | ✅ Full | Cookie + Bearer |
| Arc | ✅ Full | Cookie + Bearer |
| **Safari macOS** | ✅ Full | Bearer (cookie blocked by ITP) |
| **Safari iOS** | ✅ Full | Bearer + URL hash |

**Mobile (iOS/Android):** ✅ Responsive layout (≤768px) with hamburger sidebar nav

---

## 📁 Project Structure

```
vigil-platform/
├── docker-compose.yml          # PostgreSQL 16 + EMQX 5.8
├── README.md                   # This file (English)
├── README-TH.md                # Thai version
├── CLAUDE.md                   # AI assistant context handoff
├── DESIGN.md                   # Design system — tokens, icons, component patterns
├── SKILL.md                    # Operations playbook
├── service_start.md            # Service start/stop/troubleshoot manual
├── HARDWARE_SIZING_GUIDE.md    # Canonical hardware sizing + TCO guide
├── LICENSE                     # Proprietary license
├── .env.example
│
├── db/
│   ├── init.sql                                      # 14 base tables (idempotent — fresh install only)
│   ├── db_migration_000_schema_migrations.sql        # Migration tracking bootstrap
│   ├── db_migration_{alerts,auth,branding,...}.sql   # Legacy unprefixed migrations
│   ├── db_migration_011_analytics_event_display.sql  # Phase 7.1
│   ├── db_migration_012_alert_quiet_hours.sql        # Phase 7.2
│   ├── db_migration_013_report_schedules.sql         # Phase 7.3
│   ├── …                                             # migrations 014–044
│   └── db_migration_045_alert_min_likelihood.sql     # latest; 47 files total
│
├── scripts/
│   ├── backup.sh                                     # pg_dump -Fc → backups/
│   ├── restore.sh                                    # interactive pg_restore
│   ├── emqx-provision.js                             # Bulk EMQX MQTT user provisioner
│   ├── hooks/pre-commit                              # Pre-commit token leak scanner
│   └── keygen/                                       # License key generation tools
│       ├── issue-license.js
│       ├── setup-keys.sh
│       └── README.md
│
├── backups/                  # pg_dump archives (.dump gitignored)
├── snapshots/                # Captured event images (auto-pruned)
├── media/                    # Saved per-event MP4 clips (auto-pruned)
├── media-buffer/             # Transient RTSP segments
├── reports/                  # Scheduler-generated PNG/PDF (gitignored)
├── branding/                 # Customer logo (256×256 PNG)
├── public/others/            # Public-prefix unauth static HTML
├── map-cache/{carto,mapbox}/ # Offline tile cache
│
├── cameras-config.json       # Source of truth: camera list + lat/lon + IP + vendor
├── camera-groups.json
├── map-areas.json            # (gitignored)
│
├── dashboard/                # Frontend SPA (Vanilla JS, 27 files; served as static)
│   ├── index.html            # Main SPA shell (15+ pages)
│   ├── dashboard.js          # Core router/bootstrap (~1,379 lines; S5/MAINT-FE-001 ✅)
│   ├── page-*.js             # 19 page modules (alerts, stats, events, map, cameras, …)
│   ├── i18n.js               # Bilingual engine (Thai / English)
│   ├── icons.svg             # Self-hosted SVG sprite (18 symbols)
│   ├── design-tokens.js      # JS palette + token() helper
│   ├── theme-init.js         # Theme bootstrap (runs before DOM ready)
│   ├── report-template.js    # Shared report HTML builder
│   ├── report-print.html     # Puppeteer print target (auth-gated)
│   ├── login.html            # Brand-aware
│   └── disclaimer.html       # Brand-aware
│
└── src/                      # Backend
    ├── package.json          # 10 direct deps
    ├── .env                  # (git-ignored)
    ├── api-server.js         # Express + WS + Auth + License (proxy → report-worker)
    ├── alert-worker.js       # PM2 worker — LISTEN alert_event → rule match → LINE/push
    ├── report-worker.js      # PM2 worker — scheduler (60s) + Puppeteer PDF/PNG
    ├── mqtt-subscriber.js    # Bosch MQTT ingestion + snapshot + pg_notify alert_event
    ├── ingesters/
    │   ├── hikvision-isapi.js  # Hikvision ISAPI Alert Stream
    │   └── dahua-cgi.js        # Dahua CGI VCA event stream
    ├── routes/               # 19 route modules — factory pattern (S4/MAINT-2T-001 ✅)
    │   ├── cameras.js  stats.js  events.js  line.js  map.js  health.js
    │   ├── alert-rules.js  reports.js  report-schedules.js  appearances.js
    │   ├── auth.js  users.js  groups.js  settings.js  categories.js
    │   └── ops.js  branding.js  license.js  eula.js
    ├── media-recorder.js     # 24/7 RTSP rolling buffer + clip dump
    ├── migrate.js            # Schema migration runner
    ├── auth.js               # bcrypt + sessions + RBAC
    ├── license.js            # Ed25519/JWT license verify + machine fingerprint
    ├── alert-engine.js       # Rule matching + cooldown + quiet hours
    ├── line-sender.js        # LINE Messaging API + imgbb
    ├── report-renderer.js    # Puppeteer (PDF) + SVG+sharp (PNG health report)
    ├── stats-summary-route.js # Executive Summary / Security Morning Briefing aggregator
    ├── push-sender.js        # Expo Push API — mobile push notifications
    ├── crypto-creds.js       # AES-256-GCM encryption for camera credentials
    ├── color-utils.js        # XYZ→color name for Bosch IVA appearance payloads
    ├── singleton.js          # App-wide singleton store (pool, wss)
    ├── constants.js          # Shared constants (OFFLINE_THRESHOLD_SEC, etc.)
    └── simulator.js          # Synthetic MQTT event generator (dev only)
```

---

## 🛠️ Tech Stack

**Backend (10 direct deps):**
- Node.js 22 LTS · Express 5 · WebSocket (ws)
- PostgreSQL 16 (Docker, with `LISTEN/NOTIFY` push)
- **EMQX 5.8** (Docker — tolerant of legacy Bosch MQTT 3.1 packets; per-camera auth)
- Ingesters: `mqtt-subscriber.js` (Bosch) · `ingesters/hikvision-isapi.js` · `ingesters/dahua-cgi.js`
- `bcryptjs` · `pg` · `mqtt` · `cors` · `dotenv`
- `sharp` (logo resize + Health Report PNG) · `multer` (file upload)
- **`puppeteer`** (PDF + analytics PNG rendering with browser pool)
- **`jose`** (Ed25519 license JWT verification)
- Process management: `pm2` (ecosystem.config.js)

**Frontend:**
- Vanilla JavaScript (no framework — fast, no build step)
- OpenLayers 9 (mapping) · Chart.js 4 (analytics)
- Self-hosted SVG sprite (`dashboard/icons.svg`) · design token system (`dashboard/design-tokens.js`)
- Bilingual Thai/English engine (`dashboard/i18n.js`)

**Integrations:**
- LINE Messaging API (push notifications + scheduled image reports)
- **Expo Push API** (mobile push notifications — iOS APNs + Android FCM via Expo)
- imgbb API (image hosting, 48h expiration)
- Mapbox API (premium maps with POI — token stored in DB)
- CartoDB CDN (free fallback maps — used by both web dashboard and Vigil Mobile)
- Cloudflare Tunnel (HTTPS gateway)

**Security:**
- bcrypt (cost factor 10) · 8-char minimum password
- HMAC-SHA256 signed sessions · constant-time comparison
- HttpOnly + SameSite=Lax cookies
- **Authenticated WebSocket** — rejects anonymous upgrades (PDPA)
- **CORS allowlist** — same-origin + `ALLOWED_ORIGINS` only
- Real client IP from `CF-Connecting-IP` (X-Forwarded-For not trusted)
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`
- Pre-commit token leak scanner (`scripts/hooks/pre-commit`)

---

## 🔐 Default Credentials

After first run, log in with:
```
Username: admin
Password: changeme
```
**⚠️ The system will FORCE password change on first login.** No way to skip this step.

---

## 🗄️ Database Schema (21 Tables)

| Group | Tables | Purpose |
|-------|--------|---------|
| 📷 **Camera** | `camera_groups`, `cameras`, `camera_status_log`, `camera_offline_alerts` | Device registry + grouping + offline alert config + heartbeat log |
| 📊 **Events** | `events`, `appearances`, `license_plates` | IVA Pro / multi-vendor detection data — TIMESTAMPTZ throughout |
| 🔔 **Alerts** | `line_config`, `alert_rules`, `alert_logs`, `pending_recipients` | LINE engine — `alert_rules.active_from/to` = quiet window; self-service onboarding |
| 📅 **Reports** | `report_schedules`, `report_history` | Scheduled LINE delivery + attempt log |
| 🔐 **Auth** | `users`, `sessions`, `audit_log` | User management + audit |
| 🏷️ **Stats v2 + Brand** | `event_categories`, `event_category_rules`, `system_settings` | 10+ settings keys incl. `analytics_event_display`, `mapbox_token` |
| 📱 **Mobile Push** | `push_tokens` | Expo push device registry; `notify_alert` / `notify_face` sub-toggles; auto-disable on `DeviceNotRegistered` |
| 🛠️ **Migrations** | `schema_migrations` | Migration tracking |

See [`db/init.sql`](db/init.sql) for full schema and [`SKILL.md`](SKILL.md) for category-mapping recipes + ops playbook.

---

## 📚 Documentation Index

| Doc | Audience | What it covers |
|-----|----------|----------------|
| [`README.md`](README.md) | All | Overview, install, architecture (English) |
| [`README-TH.md`](README-TH.md) | Thai users | Same content in Thai |
| [`CLAUDE.md`](CLAUDE.md) | AI assistants / new devs | Decisions, gotchas, working agreements |
| [`DESIGN.md`](DESIGN.md) | Designers / frontend devs | Design system — tokens, icons, component patterns |
| [`SKILL.md`](SKILL.md) | Operators | Mapping recipes, troubleshooting, SQL snippets |
| [`service_start.md`](service_start.md) | Operators | Daily start/stop, health check, recovery |
| [`HARDWARE_SIZING_GUIDE.md`](HARDWARE_SIZING_GUIDE.md) | Pre-sales / architects | Hardware specs G1-G5, capacity calc, TCO |
| [`dev-docs/`](dev-docs/index.html) | Developer | Internal developer portal — file navigator, API routes reference, how-to recipes (file:// only) |

---

## 📜 License

```
Copyright © 2025-2026 Prakasit Rochanavipart (Dojo-mAn) / DojoJin Tech
All Rights Reserved.

This software is proprietary and confidential.
Unauthorized copying, distribution, modification, or use
is strictly prohibited without prior written permission.
```

See [LICENSE](LICENSE) and [`docs/EULA-th.md`](docs/EULA-th.md) for full terms.

---

## 👨‍💻 Developer

**Prakasit Rochanavipart** *(Dojo-mAn)* — **DojoJin Tech**

- 📧 Email: [prakasit@dojojin.tech](mailto:prakasit@dojojin.tech)
- 🌐 Website: [dojojin.tech](https://dojojin.tech/)
- 🆔 Handle: `@dojojin`

---

## ⚠️ Confidentiality Notice

This repository contains proprietary code and configurations. Access is restricted to authorized personnel only. Any disclosure, copying, or distribution of the contents without express written consent is prohibited and may result in legal action.

---

<sub>**Vigil Platform** v1.5.3 · by DojoJin Tech · Built with care in Thailand 🇹🇭 · © 2025-2026</sub>
