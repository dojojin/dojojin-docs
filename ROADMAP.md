# ROADMAP — DojoJin Tech Dashboard

> Companion to [CLAUDE.md](CLAUDE.md). Pending work + strategic
> directions. For shipped work see [CHANGELOG.md](CHANGELOG.md);
> for design rationale see [DECISIONS.md](DECISIONS.md).
> Last updated: 2026-06-03

---

## 🔜 Pending / Roadmap

### Operational Roadmap Ph.1-Ph.6 (approved 2026-05-23, decisions #134-#135)

- [x] ~~**Ph.1 Camera offline alert + Status Log**~~ — done 2026-05-23 (commits `8bd275a`, `ea9e869`, `+escalate_once`). Migration 018: `camera_status_log` + `camera_offline_alerts`. `checkOfflineCameras()` extended: logs transitions, fires LINE on offline + recovery, escalation, quiet hours, per-camera recipient CSV. Endpoints GET/PUT `/api/camera-offline-alerts/:id` + GET `/api/cameras/status-log`. Settings › Cameras sub-tabs (📷 Cameras | 📋 Status Log); offline alert config in camera edit form. 22 `co.*` i18n keys. Decision #134. **Follow-up (migration 019, same day):** added `escalate_once` BOOLEAN — checkbox "แจ้งครั้งเดียว (ไม่แจ้งซ้ำ)" hides the repeat-interval field. Logic: `if (!lastAlertAt || (!escalate_once && sinceLastAlert >= escalateMs))`. Reason: user feedback — "0 นาที" was being coerced to 60 by `|| 60` fallback (Math.max(1, ...) clamp anyway), so a real "no-repeat" required a separate flag.
- [x] ~~**Ph.2 Report History**~~ — done 2026-05-24 (migration 021: `report_history`). `runScheduledReport()` logs every attempt (success + failed + skipped). `POST /api/report-schedules/:id/run` manual "run now". `GET /api/report-history` (paginated) + `GET /api/report-history/:id/image` (stream PNG). Retention: rows 90d + PNG files 30d (extended `enforceRetention()`). UI: new "📜 ประวัติรายงาน" sub-tab in Settings › LINE/การแจ้งเตือน + Export CSV. 16 `rh.*` i18n keys (th+en).
- [x] ~~**Ph.3 System Health Report**~~ — done 2026-05-24 (migration 022). New report type `'health'` in `report_schedules` + `health_sections` JSONB column. `renderHealthReportImage()` + `renderHealthReportPdf()` (A4 + page numbers via `displayHeaderFooter`) in `report-renderer.js` share the same `renderHealthReportHtml()` template; server-side i18n via `HR_LABELS.{th,en}`. **4 toggleable sections** (events dropped after user feedback — overlapped with analytics report): cameras, alerts, storage, system. Cameras section: online → minimal row, offline → `created_at` + `last_seen_at` heartbeat + last frame from snapshot metadata (now `has_snapshot` after migration 025; see gotcha #43). Warning banners (offline >50% / disk >85% / RAM >85%). Range picker 24h/7d/30d/custom — applies to uptime % + alert counts. Reports page: 👁 Preview · 📄 PDF · 📥 PNG · 📤 Send to LINE Now (admin, recipient checklist + counter). 5 endpoints: `/api/health/report-data/{cameras,alerts}`, `/api/health/report/{preview,pdf}`, `POST /api/health/report/send-now` (admin, logs to `report_history` with `schedule_id=NULL`). Scheduler day-of-week gate extended to cover `'health'`. `auth.requireAuth/Admin/AdminOrAuditor` patched to bypass when `req.internal===true`. 23 `hr.*` i18n keys.
- [ ] **Ph.4 Event Management** — ack/assign/comment on events; `event_actions` table; audit trail
- [ ] **Ph.5 SOP + Claude AI suggestion** — per-rule SOP templates; Haiku generates draft on alert; operator approves before saving; NOT automation
- [x] ~~**Ph.6 Logs & History consolidated menu**~~ — done 2026-05-24. Added "📋 ประวัติและบันทึก" sidebar section using the rail+content pattern. Consolidates alert logs, report history, camera status log, audit log, and sessions. Report history / camera status / audit remain `admin-only`; sessions and alert logs remain available from the consolidated page.
  **Carry-ins from Ph.3 (added 2026-05-24):**
  1. ~~**Camera Audit Log core**~~ — done 2026-05-26 (migration 024, commit `d08aeae`). Added `audit_log.target_camera_id` + index, camera lifecycle/config hooks (add/edit/delete camera, offline-alert settings, group assignment/removal), redacted camera credentials in details, and added camera filter to the Audit Log UI. Remaining optional polish: CSV export for filtered audit rows.
  2. ~~**events schema cleanup — formerly-dead `has_snapshot` + `snapshot_filename` columns**~~ — done 2026-05-26 (migration 025). Chose option **(b)**: backfilled existing rows from `raw_json->>'_snapshot'`, patched Bosch/Hikvision/Dahua/Face Capture ingesters to update `snapshot_filename` + `has_snapshot=true`, and added partial indexes for snapshot filters. New query rule: use `has_snapshot = TRUE`; read filename via `COALESCE(snapshot_filename, raw_json->>'_snapshot')`.

### LINE Recipient Self-service Onboarding (Phase A done 2026-05-25; polish pending)

Canonical behavior and shipped implementation details live in [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md). ROADMAP keeps only remaining work.

**Phased implementation:**
- [x] **Phase A** (MVP) — migration 023 + webhook store pending + Profile API / Group Summary + UI section "🔍 ตรวจพบใหม่" + approve / ignore + webhook auto-reply.
- [x] ~~**Phase B**~~ (UX polish) — done 2026-05-27 (migration 026, commit `8b359b6`). `oa_basic_id` column + `GET /api/line-config/qr` PNG endpoint; OA Basic ID input in Settings › LINE Config; collapsible 4-step onboarding guide with QR code; 18 i18n keys (th+en); `qrcode` ^1.5.4 added.
- [x] ~~**Phase C**~~ (group lifecycle polish) — done 2026-05-27. `leave` (group/room) and `unfollow` (user) webhook events now disable the matching recipient in `line_config.recipients` (set `enabled: false`) and mark any pending row as `ignored`. Transaction-safe; real recipients unaffected if ID not found.
- [x] ~~**Phase D**~~ (block list + recipient lifecycle hardening) — done 2026-05-27 (migration 028, commits `eb3bc26` `8def7a7` `036ef0a` `b0adf0e`). auto-save on delete; `PUT /api/line-config` resets deleted recipients to `'ignored'`; CTE-based webhook UPSERT captures `prev_status` to fix auto-reply for deleted users who re-register; `'blocked'` status (permanent hard-ignore, never re-appears); block/unblock endpoints + UI; LINE push quota widget (`GET /api/line-config/quota`); pending badge + 30s auto-poll; one-time cleanup SQL for orphaned pre-fix `'approved'` rows (GOTCHAS #46).

### Modular Refactor + Security Hardening — Master Plan (2026-06-03)

> แผนเต็มอยู่ใน [`microservice_plan.md`](microservice_plan.md) — ไฟล์นี้เก็บ status summary

**Phase 0 — ทำได้ทันที, ขนานกัน** *(ไม่รอ refactor)*
- [x] ~~`SEC-2T-003`~~ — commit `src/package-lock.json` + ใช้ `npm ci` (done 2026-06-03)
- [x] ~~`OPS-2T-001`~~ — ลบ `npm run start:all` ทุกจุด → PM2/services.sh (done 2026-06-03)
- [x] ~~`SEC-2T-007`~~ — ลบ `.DS_Store` ทุกจุด + `dotfiles: 'deny'` ใน 3 static mounts (done 2026-06-03)
- [x] ~~`SEC-2T-006`~~ — health warning plaintext creds ใน `/api/health/details` (done 2026-06-03)

**Phase 1 — Origin Isolation** *(ก่อน refactor เสมอ)*
- [x] ~~`SEC-2T-001` (partial)~~ — ลบ `index.html`, `partners.html`, `reference-projects.html`, `vss_v1.html` (2026-06-03); CDN risk ของ EmailJS + Materialize หายแล้ว
- [ ] `SEC-2T-001` (remaining) — auth-gate `boxbox-th.html` + `boxbox-en.html` (Cytoscape CDN ยังอยู่)
- [ ] `SEC-2T-002` — CSP enforce (หลัง Phase 1a เท่านั้น)

**Phase 2 — Route Module Split** *(= Microservice Phase A, opportunistic)*
- [ ] สร้าง `src/helpers/routeError.js` ก่อน (SEC-2T-004)
- [ ] Extract route groups เมื่อแตะแต่ละ subsystem → `src/routes/*.routes.js`
- [ ] Merge `SEC-2T-005` (line-config role) + `SEC-2T-008` (tiles) ระหว่างทาง

**Phase 3 — Extract Heavy Workers** *(= Microservice Phase B, หลัง Phase 2 stable)*
- [ ] `alert-worker` (alert-engine + line-sender + push-sender) ผ่าน pg_notify
- [ ] `report-worker` (report-renderer) ผ่าน job queue table

**Phase 4 — API Gateway** *(optional, เฉพาะถ้า multi-host จริง)*

---

### NLQ — Natural Language Query + Unified Forensic Search (PLANNED)

> Spec: [`docs/LOGIC_nlq-search.md`](docs/LOGIC_nlq-search.md) — อ่านก่อนเริ่มทุกครั้ง

**แนวคิด:** operator พิมพ์ภาษาไทยธรรมชาติ → LLM แปลงเป็น JSON filter → query ผ่าน
endpoint เดิม. LLM ไม่แตะ SQL โดยตรง.

**Two-path strategy:**
- POC: Claude Haiku API (`@anthropic-ai/sdk`, `claude-haiku-4-5`) — เร็ว, ~$0.001/query
- Production: Ollama + Typhoon2 local — On-Prem, PDPA-safe, ตรง USP

**Backend ready:**
- ✅ `GET /api/appearances/search` (`api-server.js:4821`) — มีแล้ว; **ต้องเพิ่ม `camera_ids[]` (Phase 0)**
- ✅ `GET /api/events` (`api-server.js:2526`) — ครอบทุกกล้อง
- ❌ LPR plate search endpoint — ตาราง + index มีแต่ยังไม่มี search endpoint

**Prerequisites ก่อนเริ่ม:**
1. รัน coverage query (§2 ใน spec) บน production — รู้ว่า appearances data พร้อมแค่ไหน
2. Phase 0: เพิ่ม `camera_ids[]` ให้ `/api/appearances/search`

**Phases:**
- [ ] **Phase 0** — Multi-camera appearances (เพิ่ม `camera_ids[]`)
- [ ] **Phase 1** — `POST /api/nlq/parse` + LLM adapter (API path ก่อน)
- [ ] **Phase 2** — Location resolver (text → camera_ids fuzzy match)
- [ ] **Phase 3** — LPR plate search endpoint + หน้า Unified Forensic Search UI
- [ ] **Phase 4** — Switch to local Ollama + Typhoon2 (production)

---

### VMS Playback — On-demand Video Retrieval (PLANNED)

> Spec: [`docs/REF_vms-playback.md`](docs/REF_vms-playback.md) — อ่านก่อนเริ่มทุกครั้ง
> Primary model: **on-demand proxy** — vigil stores no video; fetches RTSP URL just-in-time from VMS when operator requests playback.

**แนวคิด:** แทนที่จะเก็บวิดีโอใน vigil server เอง operator เปิดดู playback ผ่าน VMS เดิมของลูกค้า
ลดค่า storage ได้ ~100% (เฉพาะ video) vigil ทำหน้าที่เป็น proxy เท่านั้น

**Target VMS (Qognify SGS REST API v7.2):**
- Qognify VMS, SeeTec, Coda Video, HxGN dC3 Video — ใช้ SGS API ชุดเดียวกัน
- ต้องเปิด SGS (Server Gateway Service) module ใน VMS ก่อน

**Critical traps (จาก PDF review):**
- Responses เป็น XML เสมอ — ต้อง check `<a:ErrorCode>` ใน body, ไม่ใช่ HTTP status
- Auth: Base64 encode แล้ว URL-encode อีกชั้น (`+/=` เป็น URL-special)
- RTSP URL มีอายุ 60 วินาที, single-use — request just-in-time เท่านั้น
- HTTPS บังคับ; self-signed cert พบบ่อย → ต้องรองรับ `rejectUnauthorized: false`
- ต้องติดตั้ง Qognify Transcoding Service
- RTSP ใช้ port แยก (ปกติ 9100 — verify กับ admin ก่อน)
- Browser ไม่เล่น RTSP โดยตรง → ต้อง ffmpeg proxy → HLS/fMP4 (Phase 3)

**Phases:**
- [ ] **Phase 0** — Prerequisites & Connectivity (verify SGS installed, create API user, map entityIDs, check RTSP port, add `npm install fast-xml-parser`)
- [ ] **Phase 1** — SGS Adapter Module (`src/services/qognify-sgs-adapter.js` + provider interface `src/services/vms-playback-provider.js`; smoke test connect/getCameraList/getArchiveRanges)
- [ ] **Phase 2** — JPEG Frame Fallback Path (`/api/vms/frame/:id?t=<ms>&w=<px>`; no ffmpeg needed; stepwise frame navigation in UI)
- [ ] **Phase 3** — RTSP → HLS Proxy Path (ffmpeg required; `hls.js` self-hosted; 4 vigil endpoints: `/api/vms/cameras`, `/api/vms/archive-ranges/:id`, `/api/vms/playback/:id`, `/api/vms/frame/:id`)
- [ ] **Phase 4** — Settings & Operator UI (SGS credentials in Settings page; camera VMS mapping; test connection button; env vars: `SGS_HOST`, `SGS_PORT`, `SGS_USERNAME`, `SGS_PASSWORD`, `SGS_REJECT_UNAUTHORIZED`)
- [ ] **Phase 5** *(optional)* — Event-triggered Clip Pull (operator clicks event → auto-seek to ±30s window in VMS)

**Prerequisites ก่อนเริ่ม Phase 1:**
1. Verify SGS module installed บน Qognify VMS server + Transcoding Service active
2. Create dedicated API user (ไม่ใช้ admin account)
3. Map entityIDs ของกล้องแต่ละตัวใน VMS (จาก `GET /api/service/cameras`)
4. Confirm RTSP port (9100 หรือค่าอื่น)
5. `npm install fast-xml-parser` ใน `src/`

---

### High priority (next session candidates)
- [x] ~~**PM2 production setup**~~ — done 2026-06-03 (DECISIONS #198 #199). concurrently replaced; 5 workers autostart; boot plist installed; Service Management UI shipped.
- [x] ~~**License key system**~~ — done Phase 8.0 + 8.1 (2026-05-19); see decisions #100–#108 and "Phase 8 — License MVP + EULA" Completed Features
- [ ] **Source-code protection** (Phase A: obfuscation + Node SEA binary) — design captured in "🔐 Strategic direction" roadmap section below; deferred until after first 1–2 customer pilots
- [x] ~~**Full platform rename**~~ `bosch-mqtt-dashboard/` → `vigil-platform/` — done 2026-05-29. Phase 1: file edits 26 files (commit `175cfab`); Phase 2A: DB+Docker migration — pg_dump → vigil-postgres fresh init → pg_restore (7 cameras / 51,322 events verified); Phase 2B: folder mv + GitHub rename + git remote + services start + launchd backup reloaded; Phase 3: grep clean (carve-outs intact), all services up. Rollback dump: `backups/pre-vigil-rename-20260529_124719.dump`.

### Phase 7 follow-ups (audited 2026-05-15)
- [x] ~~**Puppeteer browser pool**~~ — done 2026-05-15 (commit `36475d2`). Module-level `_getBrowser()` launches Chromium once, `_withPage()` opens a fresh page per render and closes it on exit. `disconnected` event triggers transparent relaunch on next call. `SIGINT`/`SIGTERM` close the pool cleanly. Verified: render 1=1419ms (cold), 2=159ms, 3=152ms — **~9× faster warm**. See decision #95.
- [x] ~~**WS new_event via Postgres LISTEN/NOTIFY**~~ — done 2026-05-15 (commit `1ffba23`). mqtt-subscriber now `pg_notify('new_event', <id>)` after INSERT; api-server's existing `listenClient` picked up a second channel, queries the row by id, applies the same occupancy feed + `isMetricEventType`/`isHiddenAnalyticsEvent` filters, then broadcasts. The `setInterval(..., 1000)` poll + `lastEventId` watermark are gone. End-to-end smoke verified (insert → NOTIFY → WS row delivered). See decision #96.
- [x] ~~**`src/package.json` slim-down**~~ — done 2026-05-15 (commit `a0f5b07`). 149 declared deps → 10 real direct deps: `bcryptjs, cors, dotenv, express, mqtt, multer, pg, puppeteer, sharp, ws` (+ devDep: `concurrently`). Verified clean `npm install` (235 packages → 0 vulns), all 5 entrypoints parse, full stack boots, LISTEN/NOTIFY re-verified post-strip. See decision #97.
- [ ] **PDF auto-delivery to email** — currently LINE-only (decision #91). SMTP path (generic config, not SendGrid-locked) is the natural follow-up for customers without LINE.

### Phase 5c — ✅ Reports Auto-delivery (done in Phase 7.3)
- [x] ~~Schedule daily/weekly/monthly report~~ — `report_schedules` table + scheduler loop
- [x] ~~Send to LINE~~ — image (compact / full) via imgbb + push (LINE has no file type)
- [x] ~~UI to configure schedule + recipients~~ — modal on Reports page
- [ ] ~~SMTP email~~ — see Phase 7 follow-ups above (deliberately not done in 7.3)
- [x] ~~Auto-store report history with browsable list~~ — done Ph.2 (migration 021): `report_history`, Settings › LINE "📜 ประวัติรายงาน", PNG download, CSV export, 90d row retention / 30d PNG retention

### Future versions (per Roadmap slide)
- **v1.4 (Q4 2026):** Mobile App (iOS + Android native), Push notifications, Biometric login
- **v1.5 (Q1 2027):** AI Anomaly detection, Person re-identification, Search by image
- **v2.0 (Q2 2027):** Multi-tenant SaaS, Tenant isolation, Cross-site analytics
- **v2.1 (Q3 2027):** Predictive analytics, BI dashboard, API marketplace

### Design System Migration — 6-Phase Plan (#173)

> **Approved 2026-05-28 · decision #173.** ไฟเขียว Q1/Q2/Q3 ทั้งหมด.
> ทำ incremental ไม่ใช่ big-bang. ทุก phase ship แยกได้ · rollback ปลอดภัย.
> Convention หลัง Phase 0: **new code ใช้ semantic token เท่านั้น** ห้ามแตะ `--bg/--panel` ตรงๆ.
> Legacy + semantic coexist เป็น alias ตลอด migration.
> ห้ามแตะ `src/report-renderer.js` SVG template (GOTCHAS #25a — librsvg abort).

- [x] ~~**Phase 0 — Foundation**~~ — done (verified 2026-05-29, ROADMAP stale). semantic token alias block (`--surface-base/elevated/overlay`, `--text-primary/secondary`, `--status-ok/bad`, `--border-hairline`, `--accent-muted`, `--warn`) ใน `:root`; `--bg-card`+`--card2` declared; JetBrains Mono/Sarabun purged; `dashboard/icons.svg` (18 symbols); `dashboard/design-tokens.js` (`token()` + `clearTokenCache()`); DESIGN.md 0 TODO.

- [x] ~~**Phase 0.5 — Visual Restraint**~~ — done (verified 2026-05-29). ทุก target ถูก apply ก่อนหน้านี้แล้ว: `.logo-icon`/`.user-avatar` → solid `var(--accent)`; `--accent-muted` defined; `.btn-primary:hover` ใช้ `--accent-muted`; `.src-mqtt` → `var(--accent)`; `--accent2`/`--purple`/`--cyan` ไม่มีใน `:root`

- [x] ~~**Phase 1 — Security Morning Briefing**~~ — done 2026-05-29. Layout 5 tier (Status Strip/Attention/Activity 24H/Site Map+Hotspots/Footer), default page, semantic tokens, i18n `smb.*` keys (th+en), dead `--es-*` CSS purged.

- [x] ~~**Phase 2 — Component CSS Classes**~~ — done (verified 2026-05-29, ROADMAP stale). `.field-hint` / `.text-dim` / `.row-action` / `.card-flush` / `.stack-sm/md/lg` ครบใน `index.html` บรรทัด 1172–1181; บางส่วน apply แล้วใน HTML.

- [ ] **Phase 3 — Opportunistic Migration** *(ongoing, ไม่มี deadline)*
  - ทุก PR feature/bug หลัง Phase 2: ใช้ semantic token + class จาก Phase 2 + SVG icon ใหม่
  - หน้าที่ "แตะแล้ว" → เก็บกวาด token + inline style ในส่วนนั้น
  - ❌ ห้าม sweep หน้าที่ไม่ได้แตะ · ห้ามแตะ emoji `🔕` (#90) · ห้ามแตะ Health Report SVG template

- [x] ~~**Phase 4 — Chart/Map Token Wiring**~~ — done 2026-05-29. ~20 hex replaced: OpenLayers cluster fill/stroke, chart axis ticks, stats colorize, trend arrows, per-camera bar, category chip fallback, health badge. Categorical palette arrays (COLORS[], group picker) intentionally kept. Static analysis only — runtime verify recommended.

- [x] ~~**Phase 5 — Sidebar SVG**~~ — done (verified 2026-05-29, ROADMAP stale). nav items 12 รายการ (lines 1254–1265) ใช้ `<svg><use href="#icon-..."/>` ครบ; ทุก ID resolve ใน `icons.svg`. หมายเหตุ: 14 icon IDs อื่นนอก sidebar (`icon-bell`, `icon-save`, `icon-list` ฯลฯ) ยังไม่มี symbol → render blank — เป็น Phase 3 opportunistic backlog.

- [x] ~~**Phase 6 — Polish**~~ — done 2026-05-29 (most items). Health card titles stripped (8 cards), automation/image-quality data rows, map toggle buttons (STREETS/LIGHT/CARTO/MAPBOX/ONLINE/OFFLINE), Settings Save → icon-save SVG, user role chips text, camera group ALL tab, Stats 📊→icon-stats SVG, report schedule ✏️/🗑️→SVG/⏳→…, i18n values (rep./hr./rh./rs./bk./mapMgr.*), language switcher, "All categories" option. Remaining carve-outs: LINE alert template, EULA/license modals (DESIGN.md §4). Audit log actionIcons map deferred (needs SVG sprite expansion → separate session).

### Executive Summary → Security Morning Briefing (#172)

- [x] ~~**Redesign Executive Summary → "Security Morning Briefing" (หน้าหลัก)**~~ — decision #172. Done 2026-05-29. ออกแบบใหม่ทั้งหมดสำหรับ persona = **Security Manager** (เช้ามาดูภาพรวม, ไม่ใช่ executive ที่ดู PDF report); ตอบ 3 คำถามใน 3 วินาที: (1) ระบบโอเคไหม? (2) มีอะไรต้องทำต่อไหม? (3) activity ผิดปกติไหม?

  **Layout (top → bottom = actionable → informational):**
  1. **Status Strip** — `N/total cams online · MQTT live · XX% disk · up Xd` (green/amber/red)
  2. **Attention (2-col)** — alerts 4h ล่าสุดที่มี `rule_name` + snapshot thumbnail / Offline cameras พร้อม duration (`last_seen_at`)
  3. **Activity 24H** — bar chart events/hour + Today vs Yesterday KPIs (`Events +12% ↑ · Alerts −34% ↓`)
  4. **Site Map** (ขนาดเล็ก + heatmap) + **Top Hotspots** (top 5 cameras)
  5. **Footer** — `version · uptime · snap count · clip count · backup status`

  **ตัดออก:** Traffic KPI, People KPI, Live Events feed 8 รายการ (→ Events page), Donut Event Breakdown (→ Stats page)

  **Technical changes:**
  - เปลี่ยนเป็น **default page** (ย้าย `active` class จาก `#page-cameras` → `#page-summary`)
  - เลิก `--es-*` token namespace → ใช้ main tokens (`--panel`, `--accent`, etc.)
  - เปลี่ยน fonts: ลบ `'JetBrains Mono'` / `'Sarabun'` → ใช้ `'Noto Sans Thai'` + `monospace` system fallback
  - Attention list: ใช้ `recent_events` filter `rule_name IS NOT NULL` + 4h window (ไม่ต้องรอ `acknowledged` column — Phase 2 ค่อยเพิ่ม)
  - API `/api/stats/executive-summary`: ไม่ต้องแก้ (ข้อมูลครบแล้ว — frontend แค่ไม่ render Traffic/People)

  **Phase 2 (optional, หลัง pilot):** เพิ่ม `acknowledged BOOLEAN` ใน `events` table → Attention list กรองเฉพาะ unacked; ปุ่ม Acknowledge (admin only)

### ~~Camera Pause / Maintenance Mode~~ ✅ done 2026-06-02
- [x] **Camera Pause (per-camera maintenance flag)**
  **Use case:** ย้าย Server / กล้องไป Maintenance โดยไม่ต้องการให้ระบบ connect หรือแจ้งเตือน offline
  **Scope ที่ตัดสินใจแล้ว (2026-06-02):** per-camera เท่านั้น (ไม่ทำ group-level); resume = manual เท่านั้น (ไม่มี auto-expire)

  **แผนการ implement (จาก Advisor review):**

  **1. Storage — dual-write เหมือน credential pattern**
  - `cameras.paused BOOLEAN DEFAULT FALSE` — migration 037 (idempotent)
  - `cameras-config.json` เพิ่ม `"paused": false` ต่อกล้อง (ingesters อ่านจาก config file, GOTCHAS #69)
  - API `PATCH /api/cameras/:id/pause` → toggle + write ทั้ง 2 ที่พร้อมกัน

  **2. Skip ทั้ง 5 จุด (ต้องครบ ขาดจุดใดจุดหนึ่ง feature พัง)**

  | จุด | ไฟล์ | งานที่ต้องทำ |
  |---|---|---|
  | Bosch MQTT | `mqtt-subscriber.js:processMessage` | early-return ถ้า `cameraMap[id].paused`; skip `touchCamera` ด้วย (ไม่อัป last_seen → Watchdog เห็นเป็น stale แต่ก็ skip paused) |
  | Hikvision poll | `hikvision-isapi.js` | skip camera ใน poll loop ถ้า `paused` |
  | Dahua poll | `dahua-cgi.js` | skip camera ใน poll loop ถ้า `paused` |
  | Watchdog | `api-server.js:6334` | `if (cam.paused) continue;` ก่อน transition check — ไม่ mark offline, ไม่ยิง LINE alert |
  | Status query | `api-server.js:1292+1309` | paused beats online/offline: `if (paused) status = 'paused'` ก่อน heartbeat check |

  **⚠️ กับดักสำคัญ:** `cameras.enabled` ≠ user toggle — Watchdog เขียนทับ `enabled` ทุก cycle (api-server.js:6334); **ห้ามใช้ `enabled=false` เป็น PAUSE** หรือ Watchdog จะ fight กลับ

  **3. Snapshot endpoint**
  - `/api/snapshot/live/:id` → ถ้า paused return `{paused:true, status:503}` ทันที แทน 502 failed fetch

  **4. Uptime % — exclude paused span**
  - log `'paused'` / `'resumed'` ลง `camera_status_log` เหมือน online/offline
  - uptime query (`api-server.js:5778`) — exclude ช่วงที่ status = 'paused' จาก denominator ไม่ให้นับเป็น downtime

  **5. UI**
  - ปุ่ม PAUSE ใน camera list (SVG pause icon — ไม่ใช่ emoji per CLAUDE.md #16; เพิ่ม `icon-pause` ใน sprite ถ้ายังไม่มี)
  - Badge: สีเทา `--text-secondary` / `--surface-elevated` ข้อความ "PAUSE"
  - Camera status page: หน้าจอมืด + overlay "อยู่ระหว่างการบำรุงรักษา" แทน live feed
  - i18n th+en ครบ (GOTCHAS #42)
  - responsive ≤768px (WA#2-B)
  **Implemented (commits `cefdab8`+):** migration 037 `cameras.paused`, PATCH endpoint dual-write,
  5 skip touch-points, `camera_status_log` constraint extended, `badge-paused` + `icon-pause` SVG,
  dark-screen overlay, `cam.maintenance` i18n. Bugs fixed post-ship: GOTCHAS #75 (media-recorder
  decrypt), #76 (offline-camera unpause churn via `RETURNING enabled` atomic gate).

### Service Management UI (PM2-gated — Start/Stop/Restart per service)
- [x] ~~**Phase 1: PM2 setup**~~ — done 2026-06-03 (DECISIONS #198)
  - ✅ `ecosystem.config.js` สร้างแล้ว (root; 5 apps; cwd:src/; autorestart; min_uptime:10s)
  - ✅ `scripts/services.sh` ปรับเป็น PM2 thin-wrapper (start/stop/restart/status/logs)
  - ✅ Live cutover เสร็จ: PM2 v7.0.1 installed; 5/5 online; `pm2 save` done; ↺=0 ทุกตัว
  - ✅ `pm2 startup` — `pm2.dojojin.plist` installed ใน `~/Library/LaunchAgents/`; autostart on boot

- [x] ~~**Phase 2: Service Management UI**~~ — done 2026-06-03 (DECISIONS #199)
  - ✅ Health Check page → card "Service Management" — PM2 status badge + uptime + ↺ restarts
  - ✅ Restart/Stop/Start per-service; api-server = Restart-only (Stop/Start = self-destruction guard)
  - ✅ admin-only (CSS + server-side `requireAdmin`); audit_log ทุก attempt
  - ✅ `execFile` array args (ป้องกัน injection); server-side allowlist enum
  - ✅ api-server restart → reconnect banner + poll recovery 30s
  - ✅ PostgreSQL/EMQX/cloudflared: ออกนอก scope (self-heal via `restart:unless-stopped`; docker socket = root-eq)
  - ✅ Browser verify passed: Health card renders, Restart hikvision OK, audit_log row confirmed, responsive ≤768px OK

### Nice-to-have
- [ ] **UI design-system migration (opportunistic)** — `DESIGN.md` ปักธงไว้ว่า dashboard เดิม hardcode CSS + ใช้ emoji เป็น UI แพร่หลาย (sidebar/sub-tabs/buttons). ทยอยแทนด้วย design tokens + SVG icon sprite **เฉพาะตอนแตะจุดนั้น** — ห้าม big-bang sweep. ตัวเลือกแยก (deferred, decision #142): full palette re-theme / visual overhaul เป็นงานก้อนใหญ่ของมันเอง ทำเมื่อ design tokens เสถียรแล้ว
- [ ] PostgreSQL connection pool tuning for >1000 cameras
- [x] ~~Backup automation (currently manual `pg_dump`)~~ — done in Phase 6.1.10 (daily launchd → `backups/*.dump`, 14-day retention)
- [ ] Off-host backup copy (rclone → R2/B2) — deferred; set up per customer deployment
- [ ] Alert escalation (if not acknowledged in N minutes → escalate)
- [ ] Webhook output (HTTP POST to customer's system in addition to LINE)
- [ ] **Face Recognition** — InsightFace server-side Python microservice + pgvector; plan + schema อยู่ใน [`docs/REF_face-recognition.md`](docs/REF_face-recognition.md); dev เริ่มบน Mac ได้เลย (CPU/MPS); migrate NVIDIA GPU = เปลี่ยน env var เดียว
- [x] ~~**Camera grouping → maps filter (Option B: multi-group color overlay)**~~ — done 2026-05-28 (commits `e37ef58` `a06b33f`). Legend panel overlay (top-left; horizontal wrap ≤768px), group-color stroke on markers + clusters, `hiddenGroupIds` toggle → clear+repopulate via `refreshMap()`, stats bar + heatmap filter to visible groups only, ungrouped cameras always shown. decision #155 · [docs/LOGIC_map-features.md § B](docs/LOGIC_map-features.md)
- [x] ~~**Live Pulse — Toast-on-map (T2: toggle + per-camera debounce)**~~ — done 2026-05-28 (commit `c118ea4`). Per-camera debounce 15s default (5/15/30/60s picker), bump mode "+N more", max 6 concurrent cards (evict oldest), card flip below marker when near top 20% viewport, fade 5s, snapshot thumbnail `?w=80`, `localStorage` persist, clear on page leave. decision #156 · [docs/LOGIC_map-features.md § C](docs/LOGIC_map-features.md)
- [x] ~~**Wall Mode toggle — full-screen video wall display**~~ — done 2026-05-28 (commit `d0049b6`).
- [x] ~~**FIT button — recenter map to visible cameras**~~ — done 2026-05-28 (commit `cdf427c`). `recenterMap()` fits view to `_camRawSrc.getExtent()` (visible cameras only per `hiddenGroupIds`). SVG crosshair button ใน map toolbar. CSS class `body.map-wall-mode` ซ่อน sidebar/topbar ขยาย map 100vh, WALL/EXIT WALL buttons, Fullscreen API, `localStorage` persist. decision #161 · [docs/LOGIC_map-features.md § I](docs/LOGIC_map-features.md)
- [ ] Audit Log CSV export — filter-aware export for user/camera/action audit rows
- [x] ~~**Convert "ดาวน์โหลด PDF" — html2canvas+jsPDF cleanup**~~ — done commit `2d9ba48`; CDN scripts removed from index.html.

---

## 🌐 Strategic direction — Multi-vendor (Hikvision / Dahua / generic ONVIF)

> **STATUS UPDATE 2026-05-20 — STARTED.** A real Hikvision camera arrived
> on the LAN (the "signal" the section below said to wait for), so an
> MVP shipped: `src/ingesters/hikvision-isapi.js` ingests Hikvision Smart
> Events via the ISAPI Alert Stream — see decision #114 + "Multi-vendor —
> Hikvision ISAPI ingester" under Completed Features. The text below is
> kept as the original strategy/rationale; note the phase order was
> reordered (Hikvision shipped before generic ONVIF) because that's the
> hardware in hand. Generic ONVIF is still the right broader-ROI next
> step (Phase MV.2).

**Decision discussed 2026-05-16.** Two paths were
considered when looking at expanding beyond Bosch:

**Path A (rejected for now): Deep Bosch — replace Bosch Configuration Manager**
Build our own RCP+ / IVA-XML editor inside the dashboard so customers don't
need to install Bosch CM. Estimated 6-10 weeks; the IVA rule editor alone is
~3-6 weeks of canvas-drawing UI work. Skipped because (a) Bosch CM already
works, customers tolerate it, and (b) the value proposition is narrower
than going multi-vendor.

**Path B (chosen direction): Broad — support multiple camera vendors via a
plugin architecture, leveraging common standards instead of going deep on
any one vendor.**

### Why this is the right bet

- Thai market: Hikvision + Dahua dwarf Bosch in unit count. Today the
  dashboard literally cannot sell into those sites.
- ONVIF Profile M is implemented by Bosch, Axis, newer Hikvision, Vivotek,
  Uniview, TIANDY — one generic ingester covers ~70-80% of cameras in
  one go.
- Vendor-specific HTTP Alarm Push (Hikvision ISAPI, Dahua CGI) handles
  older firmware that has ONVIF S/T but not M.
- Reduces Bosch lock-in: if Bosch changes the MQTT spec, the dashboard
  doesn't break — just the Bosch plugin needs touching.

### Target architecture (plugin pattern)

```
src/ingesters/
  bosch-mqtt.js          ← refactor of current mqtt-subscriber.js logic
  onvif-pullpoint.js     ← new: WS-Notification / PullPoint subscription
  hikvision-alarm.js     ← new: HTTP listener for ISAPI alarm POST
  dahua-alarm.js         ← new: HTTP listener for Dahua alarm POST

Common normalized event shape (matches today's `events` row):
  { camera_id, vendor, event_time, event_type, rule_name,
    object_class, event_state, snapshot, raw_json }
```

- `cameras-config.json` adds `vendor: 'bosch' | 'onvif' | 'hikvision' | 'dahua'`
- Ingesters are auto-loaded based on the union of vendors in config
- `events` table: a new `vendor` column is nice-to-have but optional;
  raw_json can carry vendor-specific fields without schema change
- alert-engine, LINE sender, stats, reports, dashboard UI: **unchanged**
- Snapshot logic in api-server's `/api/snapshot/live/:id` switches on
  vendor for the right HTTP path / auth scheme

### Phased plan (~6-8 weeks total when triggered)

1. **Phase 1 (2-3 weeks) — Generic ONVIF Profile M ingester.** Pull-point
   subscription, vendor-agnostic event metadata, snapshot via ONVIF
   MediaUri. Best ROI: one implementation covers many vendors.
2. **Phase 2 (1-2 weeks) — Hikvision HTTP Alarm Push.** Open an inbound
   HTTP endpoint the camera POSTs to, parse Hikvision's XML/JSON, and
   integrate ISAPI for snapshot + basic config.
3. **Phase 3 (1-2 weeks) — Dahua HTTP Alarm Push + CGI.** Mirror of
   Phase 2 for Dahua's protocol.
4. **Phase 4 (1 week) — Refactor Bosch MQTT into a plugin.** Existing
   subscriber code moves into `ingesters/bosch-mqtt.js` behind the
   common interface; everything else stays put.

### Do NOT start yet — wait for a real signal

This work only makes sense when there's market pull. Defer until at
least one of:

- A customer pipeline deal explicitly requires Hikvision / Dahua support.
- A pilot customer flags "we have mixed-vendor sites" as a blocker.
- Bosch announces a pricing change that lowers Bosch's share of pipeline.

Higher-priority items that should land first:
- License key system (blocker for actual selling)
- PM2 production setup (operational must-have)
- At least 2-3 real customer pilots (real data > theoretical roadmap)

### Pre-work that can happen anytime (low effort, high payoff later)

- Add a `vendor` column / field to `cameras-config.json` (default `'bosch'`)
  so existing data is forward-compatible.
- When refactoring `mqtt-subscriber.js` for anything else, take the
  opportunity to extract the Bosch-specific bits behind a single
  `processBoschEvent(payload)` function — that's most of Phase 4
  pre-built for free.
- Source the **RCP+ Programmer's Manual** (Bosch partner NDA) and the
  **Hikvision ISAPI doc** (public) into a `docs/vendor-protocols/`
  folder so they're ready when work starts.

---

## 🔐 Strategic direction — License system + source-code protection

**Status update 2026-05-19:** License system (the "trust the JWT"
half) is **✅ DONE** — Phase 8.0 + 8.1 shipped on this date; see
decisions #100–#108 and the "Phase 8 — License MVP + EULA"
section under Completed Features. The text below stays here as
historical context for the decisions made; the open item is now just
**source-code protection** (obfuscation + binary bundling), which is
deliberately deferred until after the first 1–2 customer pilots so the
binary build pipeline is shaped by real ops feedback.

### Threat model (be honest about scope)

- ❌ "Lock 100%" is impossible for any self-hosted JavaScript app — the
  customer is root on their own server.
- ✅ "Raise the bar" — make stealing the code more expensive than buying
  a license, and lean on legal recourse for the rest.

Threats addressed:
- **Casual copy** (engineer takes the codebase home) → obfuscation + binary
- **Customer non-renewal** (MA expires, customer keeps running) → license expiry + grace + legal
- **Customer-to-customer sharing** → license machine binding (Phase 2)
- **Competitor reverse engineering** → only legal recourse + (Phase 3) native critical code
- **Black-hat redistribution** → accepted residual; legal teeth + audit

### License system — chosen design

**Signed JWT, offline-first, Ed25519** (not RSA-2048: tiny keys, fast verify,
no padding gotchas).

```
~/vigil-platform/.license                    ← customer drops this file
                              │
                              ▼
  api-server boot → verify with embedded public key → cache decoded payload
                              │
                              ▼
  Enforcement points:
   - POST /api/cameras → reject if active count >= max_cameras
   - Topbar / Sidebar → show "Licensed to X · Tier · NN days left"
   - Daily job → recompute expiry; trigger warning banner at 30/7 days
   - Past expiry + 7-day grace → read-only mode (no create/edit/delete)
```

License payload (JWT body):
```json
{
  "customer":     "Acme Building",
  "customer_id":  "ACM001",
  "tier":         "STANDARD",
  "max_cameras":  500,
  "features":     ["line_alerts", "scheduled_reports", "reports"],
  "issued_at":    "2026-05-18",
  "expires_at":   "2027-05-18",
  "version":      1
}
```

Crypto choices + tooling:
- **Algorithm**: EdDSA / Ed25519 (32-byte private key, 32-byte public key,
  64-byte signature; fast verify; no padding/mode footguns)
- **Format**: JWT (RFC 7519) — standard, debuggable, future-proof
- **Library**: `jose` npm package (modern, supports Ed25519; not
  `jsonwebtoken` — that library only added EdDSA recently and the API
  is bumpier)
- **Key generation** (one-time, by us):
  ```bash
  openssl genpkey -algorithm ed25519 -out license-private.pem
  openssl pkey -in license-private.pem -pubout -out license-public.pem
  ```
- **Private key storage**: 1Password Business / cloud KMS — NEVER in repo.
  Loss = re-issue every customer license; leak = ALL licenses are forgeable.
- **Public key**: hardcoded constant in api-server.js, ships with the binary.

Per-customer issue flow:
```bash
node scripts/issue-license.js \
  --customer "Acme Building" --customer-id ACM001 \
  --tier STANDARD --max-cameras 500 \
  --expires 2027-05-18 \
  --features line_alerts,scheduled_reports,reports \
  --out licenses-issued/acme.license
# → email file to customer → they place at ~/vigil-platform/.license
```

### License — phased plan

| Phase | Scope | Effort |
|---|---|---|
| **MVP**     | JWT verify, camera-count enforce, topbar badge, issue-license CLI, expiry banner | **3-4 d** |
| **Phase 2** | Grace mode (read-only after expiry+7d), feature gating per tier, renewal flow | +2 d |
| **Phase 3** | Machine fingerprint binding (cpu_id + hostname + mac), online activation, audit log | +3 d |

### Source-code protection — layered approach

| Layer | What | Effort | Effect |
|---|---|---|---|
| 1 — Legal | Strong EULA (anti-reverse clause, penalty figures, "loaned not transferred"), Thai pwl. คอมพิวเตอร์ + Copyright Act + signed contract | 1d + lawyer fee | PRIMARY (legal recourse) |
| 2 — Obfuscation | esbuild + javascript-obfuscator on `src/*.js` + `dashboard/dashboard.js` (mangle names, strip comments, basic dead-code) | 1d setup | Stops casual code reading; ~80% of theft |
| 3 — Single binary | Node SEA (Single Executable App, Node 21+) or `@yao-pkg/pkg` — bundle everything into one opaque executable | 2-3d | Customer never sees `.js` files; ~95% of casual theft |
| 4 — License binding | License pinned to {customer_id, hostname, machine_uuid}; tampering or copying to another machine = invalid | covered by License Phase 2 | Stops customer-to-customer sharing |
| 5 — Native critical code | Rust/C++ Node addon (.node binary) for license verify + critical algorithms | 5-10d | Stops competitor reverse engineering |
| 6 — Server-side core | Move core logic to our cloud → customer becomes thin client | architecture change | NOT recommended (defeats on-premise USP) |

Deliberately NOT recommended:
- Hardware dongles (logistics nightmare, customer experience awful)
- V8 bytecode (`bytenode`) — brittle to V8 version, debug hell, easily reversed
- Heavy string encryption / control-flow obfuscation — hurts performance, not worth

Recommended bundle for v1 launch (pre-customer):
- Layer 1 (legal) — non-negotiable
- Layer 2 (obfuscation) — cheap win
- Layer 3 (binary) — high ROI
- Layer 4 (covered by license Phase 2)

Defer to post-pilot: Layer 5. Don't touch: Layer 6.

### Deployment models — affects protection ceiling

- **(A) "Toss the binary over the fence"** — customer self-installs the binary +
  config + docker-compose. We never SSH in. Maximum customer control but
  customer sees ALL files (still opaque, but they can poke around).
- **(B) "Managed install"** — we SSH in once to install. Files owned by a
  service account the customer doesn't have shell on. Customer admins via the
  web UI only. **(B) is the better protection model** but heavier ops burden.
  Recommend (B) for first 2-3 customers; (A) once we have a polished installer.

### Pre-work that can happen anytime (no commitment to launch)

- Add `licenses-issued/` to `.gitignore` so future issued licenses don't leak.
- Add `*-private.pem` to global `.gitignore` and macOS Time Machine excludes.
- Pick which features will be tier-gated and write a table (no code yet).
- Draft EULA in Thai+English so it's ready when the first customer signs.

---

---

## DB Scale — Deferred Items (2026-06-01)

วิเคราะห์แล้วว่าไม่ควรทำตอนนี้ — บันทึกไว้เพื่อไม่ต้องวิเคราะห์ซ้ำ

### daily_stats pre-aggregation table
**ปัญหาที่แก้:** query กราฟสถิติช่วงยาว (30–90 วัน) ต้องนับแสนถึงล้านแถวใน `events`
แม้มี index → ช้า 1–15s ที่ 73M แถว

**วิธี:** ตาราง `daily_stats(stat_date, camera_id, event_count, ...)` + background job
รันทุกคืน → query กราฟอ่านแค่ 90 แถว (แทน 9M)

**เงื่อนไขที่ควรทำ:**
- stats query ใน dashboard ช้าจนผู้ใช้สังเกตได้จริง (> 2–3s)
- ปริมาณข้อมูลเกิน ~10M events

**เหตุที่ defer:** ตอนนี้มี 57K events + 30s TTL cache ครอบ → ยังไม่มีปัญหาจริง
งานที่ต้องทำ: schema design + background job + query routing + stale-data handling
= effort ไม่คุ้มกับปัญหาที่ยังไม่เกิด

### CREATE INDEX CONCURRENTLY บน production
**ปัญหาที่แก้:** `CREATE INDEX` ปกติ lock ตาราง 5–30 นาทีที่ 73M แถว
→ กล้องส่ง event ไม่ได้ระหว่างสร้าง

**วิธี:** รัน `CREATE INDEX CONCURRENTLY` ด้วยมือ 1 ครั้ง นอก migrate.js
(ทำใน transaction ไม่ได้)

**เงื่อนไขที่ควรทำ:** production table > 10M แถว + ต้องเพิ่ม index ใหม่

**เหตุที่ defer:** dev DB 57K แถว — index build เสร็จใน ms; ไม่ควร automate
หรือใส่ Settings UI (DBA operation ไม่ใช่ operator operation)

**Command เมื่อถึงเวลา:**
```bash
docker exec vigil-postgres psql -U vigil_sql -d vigil_platform -c "
  CREATE INDEX CONCURRENTLY idx_appearances_camera_detected
  ON appearances(camera_id, detected_at DESC);
"
```

### ~~license_plates INSERT silent failure (bug แยก)~~ ✅ done 2026-06-02
**ปัญหา:** `mqtt-subscriber.js` INSERT ใช้ column names ชุดเก่า (`plate_likelihood`,
`country_code`, `vehicle_brand` ฯลฯ) แต่ live DB schema เป็นชุดใหม่ (`confidence`,
`country`, `region`, `bbox_*`) → INSERT ล้มเหลวเงียบทุกครั้งที่มี LPR event

**Fixed (commit `cefdab8`):** align column names + migration 036 เพิ่ม
`vehicle_type/color/brand` สำหรับ multi-vendor ANPR (Hikvision/Dahua/cloud) +
แทน silent catch ด้วย `console.error` + `v_license_plates_public` view ยืนยัน
explicit column list ไม่รั่วข้อมูลใหม่ออก partner (PDPA safe). GOTCHAS #74.

---

## 🔐 Security — Deferred Items (2026-06-01)

> วิเคราะห์แล้วว่าต้องทำแต่ยังไม่ถึงเวลา / ต้องรอข้อมูลเพิ่ม — บันทึกไว้เพื่อไม่ต้องวิเคราะห์ซ้ำ
> Full checklist: `docs/REF_security-checklist.md` (SEC-014–SEC-017)

### SEC-013 — chmod 600 cameras-config.json (ควรทำทันที)
**ปัญหา:** `cameras-config.json` เก็บ username/password/mqtt_password กล้องทุกตัว;
permissions เป็น `-rw-r--r--` (world-readable); gitignored แล้ว แต่ local-other-user อ่านได้

**Fix:** 1 คำสั่ง — ไม่แตะโค้ด
```bash
chmod 600 cameras-config.json
```
**เหตุที่ยัง deferred:** รอเจ้าของรัน (ไม่ใช่งาน CI/CD — ต้องทำที่ deployment จริง)
ดู DECISIONS #191 · GOTCHAS #69

---

### SEC-014 — Camera credential at-rest encryption
**ปัญหาที่แก้:** ถ้า `cameras-config.json` รั่ว (backup share, support handoff, laptop สูญหาย)
→ attacker ได้ username/password กล้องทุกตัวทันที

**วิธี:** AES-256-GCM encrypt ค่า `password` + `mqtt_password` ก่อน save ลงไฟล์;
decrypt ก่อนใช้ใน ingester; key เก็บใน `src/.env` (CAMERA_SECRET_KEY=<32-byte hex>)

**ไฟล์ที่ต้องแตะ:**
- `src/mqtt-subscriber.js` — decrypt ก่อนสร้าง Basic auth + ONVIF header
- `src/ingesters/hikvision-isapi.js` — เดียวกัน
- `src/ingesters/dahua-cgi.js` — เดียวกัน
- `src/api-server.js` — encrypt ก่อน write mqtt_password กลับไฟล์ (regenerate flow)
- migration utility — encrypt credentials เดิมที่อยู่ในไฟล์แล้ว

**ข้อจำกัด:** ถ้า attacker อ่าน filesystem ได้ครบ (host compromise) → ได้ทั้ง key + ciphertext
→ ต้องการ external secret store (Vault/AWS SM) ถึงจะป้องกันได้จริง

**เงื่อนไขที่ควรทำ:**
- เจ้าของยืนยัน threat model: กังวลเรื่อง "leaked backup/config share" → Tier 2 นี้เพียงพอ
- ถ้ากังวลเรื่อง "host compromise" → ต้องไปถึง Tier 3 (external secret store)

**เหตุที่ defer:** รอ threat-model decision จากเจ้าของก่อนลงมือ (medium effort + recurring complexity)
ดู DECISIONS #192

---

### ✅ SEC-015 — Drop dead columns cameras.http_password + cameras.rtsp_url
**Done 2026-06-02:** migration 038 (`db_migration_038_drop_dead_camera_columns.sql`) — NULL verified (0 rows), dry-run passed, `init.sql` updated.
`cameras.http_user` ยังอยู่ (deferred — dead แต่ไม่ใน scope SEC-015).
ดู DECISIONS #193 · GOTCHAS #70

---

### ✅ SEC-016 — PostgreSQL SSL
**Done 2026-06-02:** `ssl=on` (TLSv1.3) — self-signed cert generated in data volume; zero-downtime
via `ALTER SYSTEM` + `pg_reload_conf()`; `scripts/postgres-ssl-setup.sh` (idempotent, run after fresh volume).
Local apps unbroken. **Remaining:** `hostssl` enforcement in `pg_hba.conf` (scoped to partner subnet)
ต้องทำเมื่อเปิด remote port — ดู `docs/REF_third-party-integration.md` §3.6.
ดู DECISIONS #195

### ✅ SEC-017 — Mapbox token server-side proxy
**Done 2026-06-02:** `GET /api/map/tiles/mapbox/:style/:z/:x/:y.png` proxy (auth-gated, cache-first reusing
`MAP_CACHE_DIR/mapbox/`); `/api/config` returns `mapboxAvailable` only — raw token never sent to browser;
`dashboard.js` builds proxy URLs (not direct Mapbox API); settings form no longer prefills token.
**Alternative considered (not taken):** Mapbox URL restriction in account (zero code, but token still visible to authed users).
ดู DECISIONS #197

---

<sub>End of ROADMAP.md · Companion to CLAUDE.md · Updated 2026-06-02</sub>
