# ARCHITECTURE — Vigil Platform

> **System map only.** This file describes the current component shape,
> data boundaries, schema groups, and non-negotiable architecture invariants.
> Implementation logic, troubleshooting, SQL snippets, and operations commands
> live in the linked LOGIC/REF docs.
>
> Companion to [CLAUDE.md](CLAUDE.md) · [docs/ARCH_documentation-governance.md](docs/ARCH_documentation-governance.md)
> Last updated: 2026-06-08

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

Event-to-operator target: camera event to dashboard/LINE notification in under 2 seconds where network and third-party APIs cooperate.

---

## Runtime Components

| Component | Role | Canonical Detail |
|---|---|---|
| `src/api-server.js` | Express API, auth gate, WebSocket bridge, health endpoints, static serving | [docs/LOGIC_auth-security.md](docs/LOGIC_auth-security.md), [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `src/mqtt-subscriber.js` | Bosch MQTT ingestion, snapshot capture, `pg_notify` event/alert dispatch | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| `src/ingesters/hikvision-isapi.js` | Hikvision ISAPI Alert Stream ingestion, Smart Events, Face Capture | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md), [docs/LOGIC_face-capture.md](docs/LOGIC_face-capture.md) |
| `src/ingesters/dahua-cgi.js` | Dahua CGI event ingestion, clip/snapshot resolver path | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md), [DahuaProblem.MD](DahuaProblem.MD) |
| `src/media-recorder.js` | Rolling RTSP buffers and pre/post-event clip dump | [docs/LOGIC_camera-ingesters.md](docs/LOGIC_camera-ingesters.md) |
| `src/alert-worker.js` | Alert engine process — LINE rule matching, cooldown, quiet hours; subscribes `pg_notify('alert_event', 'alert_rules_changed')` | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/report-worker.js` | Report scheduler loop; HTTP endpoint `127.0.0.1:3001/run/:id` for on-demand triggers | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `src/alert-engine.js` | LINE rule matching logic (library module, required by alert-worker) | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/line-sender.js` | LINE push/reply API, imgbb upload, Flex message builders | [docs/LOGIC_line-notifications.md](docs/LOGIC_line-notifications.md) |
| `src/report-renderer.js` | Puppeteer PDF/PNG orchestration | [docs/LOGIC_stats-reports.md](docs/LOGIC_stats-reports.md) |
| `dashboard/` | Vanilla JS SPA, reports UI/template, i18n dictionaries | [SKILL.md](SKILL.md), [GOTCHAS.md](GOTCHAS.md) |
| `db/db_migration_*.sql` | Existing-volume schema evolution | [docs/LOGIC_infra-ops.md](docs/LOGIC_infra-ops.md) |

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

---

<sub>End of ARCHITECTURE.md · Companion to CLAUDE.md · Updated 2026-06-08</sub>
