# ARCHITECTURE — Vigil Platform

> **System map only.** This file describes the current component shape,
> data boundaries, schema groups, and non-negotiable architecture invariants.
> Implementation logic, troubleshooting, SQL snippets, and operations commands
> live in the linked LOGIC/REF docs.
>
> Companion to [CLAUDE.md](CLAUDE.md) · [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)
> Last updated: 2026-09-06

---

## Scope

`ARCHITECTURE.md` owns:

- Runtime topology and component boundaries.
- High-level data flow.
- Technology stack summary.
- Database table groups and source-of-truth boundaries.
- Cross-cutting invariants that affect implementation choices.
- Pointers to canonical live docs.

`ARCHITECTURE.md` must not contain:

- Secrets, credentials, tokens, or customer data.
- Command cookbooks or recovery steps; use [service_start.md](service_start.md) and [docs/REF_operator-sql.md](docs/REF_operator-sql.md).
- Feature behavior rationale; use `docs/LOGIC_*.md`.
- Troubleshooting recipes; use [docs/REF_troubleshooting.md](docs/REF_troubleshooting.md).
- Commercial pricing/TCO; use [HARDWARE_SIZING_GUIDE.md](HARDWARE_SIZING_GUIDE.md) and calculator artifact `docs/cost/Cost_Calculator.xlsx`.

---

## Runtime Topology

**Central deployment (default):**
```text
Bosch / Hikvision / Dahua / ONVIF cameras
        |
        | MQTT, ISAPI stream, CGI event stream, RTSP
        v
Ingester processes + media-recorder
        |
        | INSERT events, snapshot metadata, clip notifications
        v
PostgreSQL 16  <---->  api-server.js (Express + ws)
                           |
                           | Auth-gated JSON APIs, static dashboard, WebSocket
                           v
                    Dashboard SPA (Vanilla JS)
                           |
                           | HTTPS
                           v
                    Cloudflare Tunnel
```

**Edge deployment (VIGIL-ARCH-003 / EDGE_MODE=1):**
```text
Cameras (same LAN as edge box N150/Ubuntu)
        |
        | MQTT / ISAPI / CGI (local network)
        v
Edge ingesters (EDGE_MODE=1 — no DB)
        |
        | publishEdgeEvent() → NanoMQ :1883
        v
edge-bridge.js ──WSS──▶ central EMQX ──▶ mqtt-subscriber.js ──▶ PostgreSQL
                                                                      |
                                                           api-server.js / Dashboard
```

Edge details: [`docs/REF_edge-install.md`](docs/REF_edge-install.md) · [`docs/LOGIC_edge-ingester-divergence.md`](docs/LOGIC_edge-ingester-divergence.md)

Event-to-operator target: camera event to dashboard/LINE notification in under 2 seconds where network and third-party APIs cooperate.

---

## Runtime Components

| Component | Role | Canonical Detail |
|---|---|---|
| `src/api-server.js` | Express API, auth gate, WebSocket bridge, health endpoints, static serving. Static serving has two cache layers: `/dashboard.bundle.js` concatenates the longest run of adjacent local page scripts (1,749 lines on 2026-09-07 after the shell/media split (#275) and the WebSocket/jobs split (#276) — it now wires the app together and owns the auth chain, little else; `theme-init.js` / `i18n.js` deliberately excluded), version = sha1 of the concatenated bytes used as `?v=`, kill switch `DASHBOARD_BUNDLE=0`; every other `.js`/`.css` reference in the served HTML is stamped `?v=<mtime>`. Anything carrying a `?v=` is served `private, max-age=31536000, immutable` — `.html` itself stays `no-cache` (GOTCHAS #34) because it is the only thing holding the current stamps | [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md), [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `src/routes/` | Route modules split from api-server.js (factory pattern, S4/MAINT-2T-001 ✅); 53 files on 2026-09-07 (ไฟล์ใหญ่สุดเหลือ 932 บรรทัด) (that day: `api-server.js` 3,329→2,465 via `static-shell.js` + `media-files.js`; `cameras.js` 2,454→1,168 via `cameras-probe.js` / `cameras-httphost.js` / `cameras-status.js`, registration order unchanged — decision #275) — the named list below is the 2026-08-11 snapshot: alert-rules, appearances, auth, blacklist-sources, branding, cameras, categories, devices, eula, events, face-blacklist, face-push, faces, groups, hcp, health, integrations, license, line, lpr, lpr-alerts, lpr-gates, lpr-query, lpr-watchlist, map, metrics, ops, partner-api, report-schedules, reports, settings, sites, stats, traffic, users (corrected 2026-08-11 — table had drifted to a 19-file list from a much earlier split) | Loaded via `require('./routes/<name>')(app, pool, deps)` in api-server.js |
| `src/helpers/` | Shared utilities: `routeError.js`, `getSystemSetting.js` (Map cache + invalidate), `normalizeTimeOfDay.js`, `emqxPublish.js` (one-shot EMQX HTTP API publish — login+publish, used for `_config/detect-model`\|`delete-media`\|`scan-nvr` command channels) | Required directly in route files and api-server.js |
| `src/mqtt-subscriber.js` | Bosch MQTT ingestion + edge snapshot handler (`saveEdgeSnapshot` — Hik/Dahua event_id path + Bosch timestamp path), `pg_notify` event/alert dispatch | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| `src/edge/publisher.js` | Edge-only — `publishEdgeEvent()` lazy MQTT singleton to NanoMQ; exports `EDGE_MODE` flag; used by all 4 ingesters | [docs/LOGIC_edge-ingester-divergence.md](docs/LOGIC_edge-ingester-divergence.md) |
| `src/edge/bridge.js` | Edge-only PM2 process (`edge-bridge`); forwards `projects/${SITE_ID}/#` + Bosch `+/onvif-ej/#` from NanoMQ → central EMQX WSS; CONFIG_TOPIC loop-break; 60s heartbeat | [docs/LOGIC_edge-ingester-divergence.md](docs/LOGIC_edge-ingester-divergence.md) |
| `src/edge-config-agent.js` | Edge-only PM2 process; receives `cameras-config.json` push from central via MQTT retain `_config/cameras`; writes local file for ingesters | [docs/LOGIC_edge-ingester-divergence.md](docs/LOGIC_edge-ingester-divergence.md) |
| `src/ingesters/hikvision-isapi.js` | Hikvision ISAPI Alert Stream ingestion, Smart Events, Face Capture | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md), [docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md) |
| `src/ingesters/dahua-cgi.js` | Dahua CGI event ingestion, clip/snapshot resolver path | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md), [DahuaProblem.MD](DahuaProblem.MD) |
| `src/media-recorder.js` | Rolling RTSP buffers and pre/post-event clip dump | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| `src/alert-worker.js` | Alert engine process — LINE rule matching, cooldown, quiet hours; subscribes `pg_notify('alert_event', 'alert_rules_changed')` | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/report-worker.js` | Report scheduler loop; HTTP endpoint `127.0.0.1:3001/run/:id` for on-demand triggers. Also `POST /render` (same loopback listener on `REPORT_WORKER_PORT`, default 3001) — authenticated with `X-Internal-Token`, restricted to an allowlist of 6 renderer functions (`renderReportPdf`, `renderReportImage`, `renderFaceReportImage`, `renderFaceReportPdf`, `renderLprReportImage`, `renderLprReportPdf`), request body capped at 2 MB. Manual PDF/PNG downloads from api-server go through `src/helpers/renderViaWorker.js` so Chromium runs only under this process; the helper falls back to rendering in-process if the worker is down, unreachable, or answers non-2xx (120 s timeout), and `REPORT_RENDER_VIA_WORKER=0` is the kill switch | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `src/alert-engine.js` | LINE rule matching logic (library module, required by alert-worker) | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/line-sender.js` | LINE push/reply API, imgbb upload, Flex message builders | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/report-renderer.js` | Health Report PNG via SVG + `sharp` (`_svgSafeText()` strips emoji; distinct path from Puppeteer analytics reports) | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md), [GOTCHAS.md](GOTCHAS.md) #25a |
| `src/license.js` | Ed25519 JWT license — machine fingerprint (CPU+disk+MAC), online activation, offline grace, expiry check | [docs/LOGIC_license.md](docs/LOGIC_license.md) |
| `src/auth.js` | JWT triple-layer auth (cookie / Authorization header / WebSocket query) · requireAuth / requireAdmin / requireAdminOrAuditor middleware · session revoke · auditor write-block | [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md) |
| `src/push-sender.js` | Expo Push API — mobile push notifications; `notifyAlert()` + `notifyFace()`; tokens stored in `push_tokens` table; called by alert-worker + mqtt-subscriber | [SKILL.md](SKILL.md) |
| `src/crypto-creds.js` | AES-256-GCM encryption for camera credentials in `cameras-config.json`; key from `CAMERA_SECRET_KEY` env var | — |
| `src/model-detect.js` | Camera model/firmware auto-detect — vendor-specific probes: Dahua `magicBox.cgi`, Hikvision ISAPI, Bosch ONVIF `GetDeviceInformation`; triggered on camera Save (OPT5-EDGE-004) | [ROADMAP.md](ROADMAP.md) (CODEX Audit 5th optimization) |
| `src/camera-media-delete.js` | `deleteCameraMedia()` — removes a deleted camera's on-disk media across all snapshot categories/date-dirs; reject-then-use `camera_id` validation, exact dir-name matching (no prefix collision) | [ROADMAP.md](ROADMAP.md) (CODEX Audit 5th optimization, OPT5-EDGE-005) |
| `src/color-utils.js` | `xyzToColorName()` — maps Bosch IVA Pro XYZ color payload (sRGB) to English color name; 12-color canonical palette; used in appearance extraction | — |
| `src/constants.js` | Shared server-side constants — `OFFLINE_THRESHOLD_SEC = 90` (camera considered offline if no event/heartbeat within 90 s) | — |
| `src/singleton.js` | App-wide singleton store — `pool` (pg connection pool), `wss` (WebSocket server), shared refs for cross-process coordination | — |
| `src/migrate.js` | DB migration runner — scans `db/db_migration_*.sql` on api-server boot; idempotent; failed migration aborts startup (by design, GOTCHAS #81) | [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) |
| `src/stats-summary-route.js` | Standalone route (`GET /api/stats/executive-summary`) — not in `src/routes/`; registered directly in api-server.js; powers Security Morning Briefing page | — |
| `src/helpers/streamWatchdog.js` | Byte-level dead-stream detector for long-lived `timeout:0` HTTP event streams (Hikvision alertStream, Dahua eventManager) — tears down a stream after `STREAM_STALE_MS` (default 5 min) of total silence, distinct from event-level activity | [GOTCHAS.md](GOTCHAS.md) #152 |
| `src/traffic-stats-refresher.js` | `start(pool)` called from api-server.js — refreshes `traffic_hourly_stats` every 15 min (last 3 hours), prunes rows older than the retention window; no separate PM2 process | decision #237 |
| `src/face-embed-worker.js` | Own PM2 process (`face-embed-worker`, 9th app in `ecosystem.config.js`) — drains `face_embed_queue` into `face_embeddings`. Not in the Health page's `TRACKED` service list (that list is 8 names, `src/routes/health.js:33`/`:605`) | [docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md) |
| `src/kpi-stats-refresher.js` | `start(pool)` from api-server.js — refreshes the `event_kpi_hourly` pre-aggregate; first run `KPI_STATS_FIRST_RUN_MS` (45 s) after boot, part of the boot stagger that keeps the refreshers off each other | — |
| `src/category-rollup-refresher.js` | `start(pool)` from api-server.js — refreshes `event_dim_bucket` (30-minute buckets, migration 163); first run `CAT_ROLLUP_FIRST_RUN_MS` (90 s) after boot | — |
| `src/helpers/noreadCheck.js` | Weekly self-check `lpr.noread_check` — re-runs the no-read anti-join against the `COALESCE(raw_json->>'plate','')=''` predicate and logs any divergence. Sunday 04:30 ICT (deliberately after the ~04:05 backup, never on boot); `NOREAD_CHECK_INTERVAL_MS` is a test-only override | decision #265 |
| `src/helpers/renderViaWorker.js` | `render(fn, args)` — posts to report-worker `POST /render` over loopback with `X-Internal-Token`; same 6-function allowlist checked on both ends; 120 s timeout; falls back to in-process render on any failure. `REPORT_RENDER_VIA_WORKER=0` (or a missing `INTERNAL_API_SECRET`) skips the round trip entirely | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `src/helpers/dashboardBundle.js` | `bundleIndexHtml()` — finds the longest run of adjacent plain `<script src="/x.js">` tags in `dashboard/index.html` and replaces it with one `/dashboard.bundle.js?v=…` tag. `/vendor/…`, `theme-init.js` and `i18n.js` never join; a tag with `defer`/`async`/`type`/`nonce` ends the run, as does any element between two tags | decision #268 |
| `src/helpers/scrubRawJson.js` | Strips camera IP/MAC out of `raw_json.rawXml` before a non-admin sees it — used by the WebSocket broadcast and by `/api/appearances/search` | [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md) |
| `src/simulator.js` | Dev-only — publishes fake Bosch MQTT events to EMQX for local testing; must not run in production | — |
| `dashboard/` | Vanilla JS SPA (48 `.js` files on 2026-09-06) — `dashboard.js` core + 32 `page-*.js` page files (S5/MAINT-FE-001 ✅) + `i18n.js` + `design-tokens.js` + `theme-init.js` + report templates | [SKILL.md](SKILL.md), [GOTCHAS.md](GOTCHAS.md), [dev-docs/file-navigator.html](dev-docs/file-navigator.html) |
| `db/db_migration_*.sql` | Existing-volume schema evolution (189 numbered files + 17 legacy-named = 206 total on 2026-09-06, latest: 199_events_anpr_noread_index) | [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) |

---

## Technology Stack

| Layer | Current Choice |
|---|---|
| Backend runtime | Node.js 22 LTS (v22.22.3) |
| API framework | Express 5 |
| Realtime | `ws` WebSocket + PostgreSQL `LISTEN/NOTIFY` |
| Database | PostgreSQL 16 in Docker |
| MQTT broker | EMQX 5.8.9 in Docker (TCP `:1883` all-interfaces, AUTHN enforced; dashboard `:18083` localhost-only) |
| Frontend | Vanilla JavaScript, no framework/build step |
| Maps | OpenLayers 9 with CartoDB fallback and optional Mapbox |
| Charts | Chart.js 4 |
| Reports | Shared HTML template + Puppeteer (PDF, analytics PNG); Health Report PNG via SVG + `sharp` |
| Images | Local auth-gated snapshots/media; imgbb only for LINE image delivery |
| Public ingress | Cloudflare Tunnel |

---

## Data Flow

### Event Ingestion

1. Vendor-specific ingester normalizes camera event into the shared `events` table.
2. Ingester emits `pg_notify('new_event', event_id)` so `api-server.js` can push the full row to WebSocket clients.
3. Ingester emits `pg_notify('event_for_clip', payload)` for media-recorder where clip capture is enabled.
4. Ingester emits `pg_notify('alert_event', payload)` so `alert-worker.js` can evaluate LINE alert rules independently.
5. Snapshots are stored locally and referenced through `events.snapshot_filename` / `has_snapshot`, kept in sync with `raw_json->>'_snapshot'`.

### Dashboard Realtime

`api-server.js` listens for `new_event`, reloads the event row, applies display filters where needed, and broadcasts to authenticated WebSocket clients. Event-listing pages should not depend on polling or manual refresh.

A connection is authenticated at `verifyClient` time — an unauthenticated socket never joins the broadcast set. Beyond that, `broadcast()` (`src/api-server.js:1778–1810`) emits **three different payloads for the same event**, chosen per socket:

| Variant | Who gets it | Shape |
|---|---|---|
| **lite** | any socket that has not subscribed to the event's topic — the default, since `ws._topics` starts empty (`src/api-server.js:1706`) | `{type, lite: true, event: …}` with only the fields the counters and the map pulse need (≈330 B) — built by `_liteEvent()` (`:1758`) |
| **full, scrubbed** | subscribed sockets belonging to a non-admin user, when the row actually carries `raw_json.rawXml` | full row with `raw_json` passed through `scrubRawJson()` — camera IP/MAC removed (`:1789`, `:1802`) |
| **full** | subscribed admin sockets | the row as loaded |

A client opts into the heavy stream by sending `{"type":"subscribe","topics":["lpr","face"]}` (`:1708–1716`); unknown topic names are dropped, and a later `subscribe` replaces the whole set rather than adding to it. Not subscribing means *lite*, not *nothing* — the counters on every page keep working. Both `ws.send` call sites and the receiving handler have to agree on the envelope: GOTCHAS #189.

### Reports

Stats and Reports share data paths and rendering primitives. Scheduled reports render PNGs for LINE; on-demand exports can render PDF/PNG. Report delivery rules live in [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md); renderer rules live in [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md).

---

## Database Map

**Corrected 2026-08-11** — this section previously claimed "21 base tables," stale since roughly migration ~020. Verified directly against the live `public` schema (`information_schema.tables`), not derived from migration files (some migrations `ALTER`, not `CREATE`):

**`public` schema: 70 physical base tables (counted 2026-08-11)** = ~45 logical tables + `events`' monthly range partitions + `events_default`. The partition count is **not fixed** — it moves with retention as old months are dropped and future months pre-created: **21 on 2026-09-06** (`CODEX/CODEX_MODULAR_PERFORMANCE_AUDIT_2026-09-06.md:483`, not re-measured here), against 24 when the 70 was counted. Re-derive both together before quoting the sum.
**`blacklist` schema (separate namespace, inbound integrations): 6 tables.**
**Total application tables: ~51 logical / 76 physical.**

| Group | Tables | Notes |
|---|---|---|
| Camera config/runtime | `camera_groups`, `cameras`, `camera_httphost_backups`, `sites`, `user_sites`, `hcp_camera_map`, `ingester_camera_status`, `edge_status` | Runtime heartbeat/state is DB; configured camera list is JSON config. `sites`/`user_sites` = multi-site scoping (Tier 1). `hcp_camera_map` links our `camera_id` to HCP's `cameraIndexCode` (migration 126) |
| Events | `events` (partitioned — monthly partitions + default; 21 on 2026-09-06, count varies with retention), `appearances`, `license_plates` | Shared multi-vendor event store; `events` partitioned by `event_time`, composite PK `(id, event_time)` |
| Rollups / pre-aggregates | `event_dim_bucket`, `event_kpi_hourly`, `lpr_dim_daily`, `lpr_hourly_stats`, `traffic_hourly_stats` | Nothing user-facing should scan the 40M-row `events` or the 30M-row `license_plates` for a count. `event_dim_bucket` (migration 163) = events per **30 minutes** by the dimensions the category rules read — deliberately 30 min, not hourly, because the "today"/"yesterday" charts are 30-minute buckets; refreshed by `src/category-rollup-refresher.js` and read by health, facets, suggestions, rule discovery and the image-quality log. `lpr_dim_daily` (migration 171) = daily plate dimensions, read by `GET /api/lpr/brands` (`src/routes/lpr-query.js:485`, `:728`) and by `src/traffic-stats-refresher.js`. `event_kpi_hourly`, `lpr_hourly_stats`, `traffic_hourly_stats` predate these |
| Traffic Enforcement | `traffic_hourly_stats` | Pre-aggregate of `license_plates` (camera × hour × vehicle_type), refreshed every 15 min by `src/traffic-stats-refresher.js` — 42x faster than querying `license_plates` directly (decision #237); added 2026-08-11. Daily reconcile runs at 05:00, outside the 03:04–04:05 backup window, with a persisted marker so a restart neither repeats nor skips it (decision #267) |
| Face Recognition | `face_blacklist`, `face_blacklist_groups`, `face_blacklist_hits`, `face_embed_queue`, `face_embeddings`, `face_event_acks`, `face_event_notes` | AuraFace-v1 embedding pipeline + HCP-enrolled blacklist (migrations 129–139) |
| LPR / ANPR | `lpr_alert_acks`, `lpr_alert_cooldown`, `lpr_alert_hourly`, `lpr_gates`, `lpr_mismatch_dismissals`, `lpr_watchlist`, `lpr_watchlist_groups` | Watch-list alerting on plate matches; `lpr_watchlist` rows can originate from manual entry or the blacklist bridge (`origin` column) |
| Stats categories | `event_categories`, `event_category_rules` | Query-time all-match category mapping |
| LINE alerts | `line_config`, `alert_rules`, `alert_logs`, `pending_recipients` | LINE config/rules/logs and admin-approved recipient onboarding |
| Reports | `report_schedules`, `report_history` | Scheduled delivery config and send history |
| Camera operations | `camera_status_log`, `camera_offline_alerts` | Heartbeat transition history and offline/recovery alert config |
| Auth/audit | `users`, `sessions`, `audit_log`, `push_tokens` | Admin/viewer/auditor roles; user/session/camera-targeted audit trail (incl. `AFTER UPDATE` trigger on `users.password_hash`, migration 140, GOTCHAS #150); mobile push device tokens |
| Settings/migrations | `system_settings`, `schema_migrations` | Key/value settings and migration tracking; `system_settings.nav_hidden_pages` (JSON array, migration 141) stores which sidebar menu keys are hidden — hide-list not show-list, `"settings"` can never appear in it (decision #239) |
| Partner API | `api_consumers`, `api_request_log` | Outbound partner integration — consumer identity/expiry/rate + per-request audit log (migrations 119, 122–123). Privilege enforced by Postgres `GRANT`/`SET LOCAL ROLE` on each consumer's own `db_role`, not by application code — see `docs/REF_partner-api-tunnel.md`, `docs/REF_partner-onboarding.md`, `docs/REF_third-party-integration.md` |
| Host metrics | `metrics_host` | Per-machine CPU/RAM/disk/network + tunnel/tailscale connectivity time-series (migrations 097, 101) |
| **`blacklist` schema** | `blacklist.sources`, `blacklist.source_records`, `blacklist.master`, `blacklist.master_links`, `blacklist.overrides`, `blacklist.bridge_rules` | Inbound watch-list import from DSS Pro / GuruSquare / HCP / manual entry (migration 093+) — see `docs/superpowers/specs/2026-07-24-blacklist-central-database-design.md`. `source_records` mirrors the source faithfully; `overrides` holds local corrections (no write access to source systems themselves); `master`/`master_links` dedupe identities across sources; `bridge_rules` selects which records flow into `lpr_watchlist` for live alerting |

Schema evolution rules:

- `db/init.sql` is fresh-install baseline only.
- Existing databases evolve through idempotent `db/db_migration_*.sql`.
- Migration runner is fail-fast before API listen.
- Applied migration history is stored in `schema_migrations`.

Canonical details: [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md), [docs/REF_operator-sql.md](docs/REF_operator-sql.md).

---

## Retention Model

Data retention is class-based, governed by system settings and enforced by daily/hourly background jobs:

| Class | Setting | Default | Enforcer | Notes |
|---|---|---|---|---|
| General events | `data_retention_days` | 365 | `src/api-server.js` (daily) | Applies to `events` table; **excludes `anprAlarm` rows** (decision #213) |
| LPR (license plate) rows | `lpr_retention_days` | 30 | `src/api-server.js` (daily, `enforceLprRetention`) | Sole authority over `license_plates` table; raising to years gated on P2/2B partitioning |
| LPR images | `lpr_image_retention_days` | 7 | `src/lpr-retention.js` (daily) | Deletes files from `snapshots/lpr/` older than N days (≤ lpr_retention) |
| rawXml metadata | `rawxml_retention_days` | 90 | `src/api-server.js` (daily, `enforceRawXmlRetention`) | Strips `raw_json->>'rawXml'` from `events`; decision #212 |
| Edge Bosch scene snapshots | `EDGE_IMAGE_RETENTION_DAYS` | 7 | `src/edge/bridge.js` (hourly) | Edge prunes `snapshots/events/<YYYY-MM-DD>/` older than N days; no api-server present on edge (decision #214) |

Central enforcers run in `src/api-server.js` (`setTimeout` ~60–150s after boot, then `setInterval` every 24h — no fixed clock time) except the edge, which prunes in `src/edge/bridge.js` (hourly async, logic in `src/edge/snapshot-retention.js`). Env vars: [docs/REF_edge-install.md](docs/REF_edge-install.md).

---

## Source Of Truth Boundaries

| Domain | Source Of Truth |
|---|---|
| Configured camera list, vendor, connection settings, lat/lon | `cameras-config.json` |
| Camera runtime heartbeat/state | `cameras` table |
| Event history | `events` table |
| Snapshot pointer on events | `events.snapshot_filename` + `events.has_snapshot` (legacy metadata also remains in `raw_json->>'_snapshot'`) |
| Snapshot files | `snapshots/` |
| Clip files | `media/` |
| LINE recipient roster | `line_config.recipients` |
| Pending LINE self-service recipients | `pending_recipients` |
| Report schedules/history | `report_schedules`, `report_history` |
| Product branding/settings/license | `system_settings` |
| User/session/camera audit | `users`, `sessions`, `audit_log.target_camera_id` |

---

## Architecture Invariants

- Frontend stays vanilla JS. Do not migrate to React/Vue/Svelte/Next without explicit decision reversal.
- Backend uses raw SQL through `pg`. Do not introduce an ORM.
- Media, snapshots, dashboard private assets, and report history images stay auth-gated unless explicitly classified public.
- Safari-compatible auth remains multi-layer: cookie + localStorage/Bearer fallback + URL-token support where already required.
- Camera config JSON and runtime DB state are intentionally separate.
- Snapshot queries should use `events.has_snapshot` / `snapshot_filename`; ingesters also keep `raw_json->>'_snapshot'` for legacy metadata.
- `alert_rules.active_from` / `active_to` mean LINE quiet hours, not active hours.
- WebSocket connections require a valid session.
- LINE webhook signature verification must use raw request bytes when `channel_secret` is configured.
- Long-running services should be controlled through `scripts/services.sh` and singleton PID locks.
- UI colors come from a tri-layer design token single source (CSS custom properties + JS palette + report inject); icons are self-hosted SVG (`currentColor`), not emoji or webfont. Server-side SVG report render (`sharp`/librsvg) must not contain emoji. Canonical: [DESIGN.md](DESIGN.md).

See [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md) for the full STUBBORN_FACT index.

---

## File Ownership

| Need | Read |
|---|---|
| Auth, sessions, RBAC, public/private route policy | [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md) |
| UI design system — tokens, SVG icons, component patterns, theming, no-emoji | [DESIGN.md](DESIGN.md) |
| LINE alerts, imgbb, recipients, webhook onboarding, quota | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| Stats, reports, Puppeteer, health report | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| Camera ingesters, clips, snapshots, vendor behavior | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| Dahua snapshot timing/live incident work | [DahuaProblem.MD](DahuaProblem.MD) |
| Face Capture and gallery | [docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md) |
| License/EULA | [docs/LOGIC_license.md](docs/LOGIC_license.md) |
| Migrations, backup/restore, service lifecycle, branding | [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) |
| Troubleshooting | [docs/REF_troubleshooting.md](docs/REF_troubleshooting.md) |
| SQL snippets and settings reference | [docs/REF_operator-sql.md](docs/REF_operator-sql.md) |
| REST API reference — all endpoints, auth levels, params, response shapes, WebSocket | [docs/REF_api-reference.md](docs/REF_api-reference.md) |
| Operator playbook (English) — mapping recipes, settings, health check, runtime stack | [SKILL.md](SKILL.md) |
| Operator playbook (Thai) — same content, Thai prose + English technical terms with remarks | [SKILL-TH.md](SKILL-TH.md) |
| Daily start/stop/recovery | [service_start.md](service_start.md) |
| Pending work | [ROADMAP.md](ROADMAP.md) |
| Completed work | [CHANGELOG.md](CHANGELOG.md) |
| Documentation ownership rules | [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md) |
| Developer portal — file navigator, API routes reference, how-to recipes | [dev-docs/index.html](dev-docs/index.html) |

---

<sub>End of ARCHITECTURE.md · Companion to CLAUDE.md · Updated 2026-09-06</sub>
