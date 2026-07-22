# ARCHITECTURE — Vigil Platform

> **System map only.** This file describes the current component shape,
> data boundaries, schema groups, and non-negotiable architecture invariants.
> Implementation logic, troubleshooting, SQL snippets, and operations commands
> live in the linked LOGIC/REF docs.
>
> Companion to [CLAUDE.md](CLAUDE.md) · [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)
> Last updated: 2026-06-25

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
| `src/api-server.js` | Express API, auth gate, WebSocket bridge, health endpoints, static serving | [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md), [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `src/routes/` | Route modules split from api-server.js (factory pattern, S4/MAINT-2T-001 ✅); 19 files: alert-rules, appearances, auth, branding, cameras, categories, eula, events, groups, health, license, line, map, ops, report-schedules, reports, settings, stats, users | Loaded via `require('./routes/<name>')(app, pool, deps)` in api-server.js |
| `src/helpers/` | Shared utilities: `routeError.js`, `getSystemSetting.js` (Map cache + invalidate), `normalizeTimeOfDay.js`, `emqxPublish.js` (one-shot EMQX HTTP API publish — login+publish, used for `_config/detect-model`\|`delete-media`\|`scan-nvr` command channels) | Required directly in route files and api-server.js |
| `src/mqtt-subscriber.js` | Bosch MQTT ingestion + edge snapshot handler (`saveEdgeSnapshot` — Hik/Dahua event_id path + Bosch timestamp path), `pg_notify` event/alert dispatch | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| `src/edge/publisher.js` | Edge-only — `publishEdgeEvent()` lazy MQTT singleton to NanoMQ; exports `EDGE_MODE` flag; used by all 4 ingesters | [docs/LOGIC_edge-ingester-divergence.md](docs/LOGIC_edge-ingester-divergence.md) |
| `src/edge/bridge.js` | Edge-only PM2 process (`edge-bridge`); forwards `projects/${SITE_ID}/#` + Bosch `+/onvif-ej/#` from NanoMQ → central EMQX WSS; CONFIG_TOPIC loop-break; 60s heartbeat | [docs/LOGIC_edge-ingester-divergence.md](docs/LOGIC_edge-ingester-divergence.md) |
| `src/edge-config-agent.js` | Edge-only PM2 process; receives `cameras-config.json` push from central via MQTT retain `_config/cameras`; writes local file for ingesters | [docs/LOGIC_edge-ingester-divergence.md](docs/LOGIC_edge-ingester-divergence.md) |
| `src/ingesters/hikvision-isapi.js` | Hikvision ISAPI Alert Stream ingestion, Smart Events, Face Capture | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md), [docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md) |
| `src/ingesters/dahua-cgi.js` | Dahua CGI event ingestion, clip/snapshot resolver path | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md), [DahuaProblem.MD](DahuaProblem.MD) |
| `src/media-recorder.js` | Rolling RTSP buffers and pre/post-event clip dump | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| `src/alert-worker.js` | Alert engine process — LINE rule matching, cooldown, quiet hours; subscribes `pg_notify('alert_event', 'alert_rules_changed')` | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/report-worker.js` | Report scheduler loop; HTTP endpoint `127.0.0.1:3001/run/:id` for on-demand triggers | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
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
| `src/simulator.js` | Dev-only — publishes fake Bosch MQTT events to EMQX for local testing; must not run in production | — |
| `dashboard/` | Vanilla JS SPA (27 files) — `dashboard.js` core + 19 `page-*.js` page files (S5/MAINT-FE-001 ✅) + `i18n.js` + `design-tokens.js` + `theme-init.js` + report templates | [SKILL.md](SKILL.md), [GOTCHAS.md](GOTCHAS.md), [dev-docs/file-navigator.html](dev-docs/file-navigator.html) |
| `db/db_migration_*.sql` | Existing-volume schema evolution (81 numbered files + a few legacy-named, latest: 091_camera_model_detect_status) | [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) |

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

### Reports

Stats and Reports share data paths and rendering primitives. Scheduled reports render PNGs for LINE; on-demand exports can render PDF/PNG. Report delivery rules live in [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md); renderer rules live in [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md).

---

## Database Map

Current public schema: 21 base tables.

| Group | Tables | Notes |
|---|---|---|
| Camera config/runtime | `camera_groups`, `cameras` | Runtime heartbeat/state is DB; configured camera list is JSON config |
| Events | `events`, `appearances`, `license_plates` | Shared multi-vendor event store |
| Stats categories | `event_categories`, `event_category_rules` | Query-time all-match category mapping |
| LINE alerts | `line_config`, `alert_rules`, `alert_logs`, `pending_recipients` | LINE config/rules/logs and admin-approved recipient onboarding |
| Reports | `report_schedules`, `report_history` | Scheduled delivery config and send history |
| Camera operations | `camera_status_log`, `camera_offline_alerts` | Heartbeat transition history and offline/recovery alert config |
| Auth/audit | `users`, `sessions`, `audit_log`, `push_tokens` | Admin/viewer/auditor roles; user/session/camera-targeted audit trail; mobile push device tokens |
| Settings/migrations | `system_settings`, `schema_migrations` | Key/value settings and migration tracking |

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

<sub>End of ARCHITECTURE.md · Companion to CLAUDE.md · Updated 2026-06-15</sub>
