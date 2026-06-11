# Technical Engineering Review 2026: Vigil Platform

Date: 2026-06-07  
Language: English companion document  
Pair file: `technical_engineering_review_2026-06-07.html`  
Scope: coding, system architecture, database, frontend, security, performance, operations, testing, and technical sustainability

## 1. Executive Summary

Vigil Platform is beyond prototype maturity. It has a real production-oriented architecture, multiple isolated runtime processes, a mature PostgreSQL-centered data model, security hardening, audit trails, operational scripts, and strong project memory through decisions and gotchas.

The main technical conclusion:

> The system does not need a rewrite. It needs stronger guardrails around an already-working architecture.

The strongest areas are:

- practical single-host/on-prem architecture;
- PM2 worker isolation;
- vendor-specific camera ingesters;
- raw SQL where query control matters;
- auth-gated media/static serving;
- RBAC and audit controls;
- disciplined migrations;
- operational documentation;
- initial `node:test` coverage.

The highest-risk areas are:

- large core files (`api-server.js`, `dashboard.js`);
- limited integration/security smoke tests;
- authenticated dashboard still loading third-party vendor JavaScript;
- heavy analytics queries that need scale evidence;
- health diagnostics that may become I/O heavy;
- manual partitioning and off-host backup still requiring operational hardening.

## 2. Evidence Base

The review is based on repository inspection and current project documentation. No secrets, `.env` files, camera credential files, media, snapshots, reports, or customer data were inspected.

Verified facts:

| Area | Fact | Technical Meaning |
|---|---|---|
| Runtime | PM2 runs 7 apps: `api-server`, `mqtt-subscriber`, `media-recorder`, `hikvision`, `dahua`, `report-worker`, `alert-worker`. | The system has real process isolation and is no longer a single Node process. |
| Backend size | `src/api-server.js` is about 6,480 lines with 126 route declarations. | Feature breadth is high, but route-order and middleware drift remain risks. |
| Frontend size | `dashboard/dashboard.js` is about 10,601 lines; `dashboard/index.html` about 3,661 lines. | The SPA is feature-rich but expensive to maintain and test. |
| Database | Migrations, `schema_migrations`, retention handling, and manual events partition plan exist. | Database discipline is good, but analytics scale needs benchmark proof. |
| Security | Auth-gated media/static paths, CSP, RBAC, audit logging, upload validation, and dependency upgrades exist. | Strong posture, with remaining browser supply-chain and network-surface concerns. |
| Tests | 4 `node:test` files cover helpers, crypto credentials, alert engine, and color utilities. | Good starting point, but route/auth/CSP/DB integration tests are still missing. |

## 3. System Architecture Review

### Strengths

The architecture is well matched to the product's current deployment model.

Key strengths:

- **Modular monolith with workers:** The project avoids premature full microservices while isolating crash-prone or blocking work into separate PM2 processes.
- **PostgreSQL-centered system of record:** Events, sessions, audit logs, reports, alerts, and settings live in the database with clear ownership.
- **LISTEN/NOTIFY is appropriate:** It provides low-complexity internal event propagation without adding Kafka/RabbitMQ/Redis prematurely.
- **Vendor-specific ingester boundaries:** Bosch, Hikvision, and Dahua behavior differs enough that separate ingesters are the correct boundary.
- **PM2 plus Docker split is pragmatic:** PostgreSQL and EMQX in Docker, Node workers under PM2, fits single-host edge deployments.

### Weaknesses

- `api-server.js` is still a partial god-file.
- Worker coordination depends on conventions and shared secrets rather than a typed service contract.
- Camera config JSON and runtime DB state are intentionally separate, but this requires ongoing drift protection.
- There is no durable job queue yet; pg_notify and loopback HTTP are sufficient now, but report/alert scale may eventually require a table-backed queue.

### Architecture Grade

**B+**

The current architecture is sound for single-tenant on-prem deployments. The next improvement should be route/module extraction plus smoke tests, not a broad rewrite.

## 4. Backend Coding Review

### Strengths

- Raw SQL is the right choice for this system because analytics, time windows, JSONB, category rules, and migrations need precise control.
- Auth and RBAC patterns have improved: global API gate, role checks, internal-token support, auditor write-blocking, EULA/license gates.
- File serving is cautious: media and snapshots are gated, filenames are checked, dotfiles are denied, and public prefixes are narrow.
- Upload validation has multiple layers: role, size, MIME, magic bytes, SVG rejection, and `sharp` normalization.
- Admin operations use allowlists and `execFile`, reducing command injection risk.

### Weaknesses

- Too many routes remain in `api-server.js`.
- Error handling is not yet uniform across all routes.
- Some helpers are duplicated between `api-server` and `report-worker`.
- Several runtime behaviors depend on operational conventions: internal token, worker health, report queue, config reload.

### Backend Recommendation

Continue extracting route groups by domain:

- health;
- reports;
- line configuration;
- backup/service management;
- stats;
- camera operations.

Each extracted group should receive route-level smoke tests.

## 5. Frontend Engineering Review

### Strengths

- Vanilla JS reduces build complexity and fits on-prem debugging.
- The dashboard has broad functionality: live events, maps, stats, reports, settings, health, LINE, audit/history, and camera management.
- The i18n system is disciplined: Thai source, English translation layer, documented parity requirements.
- CSP migration removed a large amount of inline handler/script risk.
- A design system direction exists: semantic tokens, SVG icons, no-emoji rule, responsive expectations.

### Weaknesses

- `dashboard.js` is too large.
- There is no module/lazy-load boundary for heavy map/report/chart code.
- Runtime vendor libraries are still loaded from CDN.
- Legacy UI patterns remain, including grandfathered icon/emoji and inline-style areas.

### Frontend Recommendation

Do not rewrite the frontend to React/Vue/Svelte. Instead:

- split the existing vanilla JS by page/domain;
- self-host OpenLayers and Chart.js assets;
- lazy-load heavy map/report/chart paths;
- add smoke tests for login, events, health, reports, and LINE settings;
- keep new UI work on semantic tokens and SVG icons.

## 6. Database Review

### Strengths

- Migration discipline is good.
- Fresh schema and existing-volume evolution are separated.
- `schema_migrations` tracks applied migrations.
- Event model supports multi-vendor payloads through shared columns and `raw_json`.
- Snapshot columns were activated for queryability.
- Manual partition plan exists for large `events` growth.

### Weaknesses

- Analytics queries are likely to become the main database bottleneck.
- Category stats rely on joins and `COUNT(DISTINCT)` patterns that need benchmarking.
- `/api/events` uses total counts, offset pagination, and free-text `ILIKE` patterns.
- Partitioning is manual and needs explicit thresholds and runbooks.

### Database Recommendation

Before large deployments:

- capture `EXPLAIN (ANALYZE, BUFFERS)` baselines;
- define events row-count/table-size thresholds;
- document the partition runbook;
- add slow-query logging for stats endpoints;
- consider rollup tables or materialized category mappings when data volume justifies it.

## 7. Security Engineering Review

### Strong Controls

- Auth-gated media and snapshot serving.
- Dashboard/static route protection.
- CSP enforcement and inline handler cleanup.
- RBAC with admin/viewer/auditor separation.
- Audit logging for sensitive operations.
- Upload magic-byte validation.
- Internal-token timing-safe comparison.
- EMQX authentication enabled.
- PostgreSQL bound to localhost.
- Dependency stack recently upgraded.

### Remaining Concerns

- Authenticated dashboard still loads third-party JavaScript from jsDelivr.
- MQTT port 1883 binds all interfaces; acceptable only with verified firewall/source restrictions.
- Internal token is high-trust and should produce production health warnings if missing or mismatched.
- Automated route security regression coverage is still missing.

### Security Recommendation

Priority order:

1. Self-host dashboard vendor JavaScript and remove jsDelivr from CSP.
2. Add route/auth/static/CSP smoke tests.
3. Verify MQTT anonymous publish/subscribe rejection and host firewall rules.
4. Add production warning/fail-fast behavior for missing `INTERNAL_API_SECRET`.

## 8. Performance And Scalability Review

### Good Work Already Done

- DB pool max configured per worker.
- `application_name` configured for PostgreSQL observability.
- Worker split reduces API background load.
- Puppeteer render queue prevents concurrent render memory spikes.
- Some stats endpoints have cache.
- Dead indexes were audited and removed.
- Snapshot thumbnail paths reduce UI payload.

### Likely Bottlenecks

- Stats/category analytics queries.
- Events listing with deep offset and total counts.
- Health details endpoint scanning media/snapshot directories.
- Frontend parse/load time from monolithic dashboard JS.
- Report queue latency under concurrent manual and scheduled renders.

### Performance Recommendation

- Add query timing logs for stats endpoints.
- Cache or split `/api/health/details` into fast and deep diagnostics.
- Expose report render queue length and oldest job age.
- Add keyset pagination for deep event browsing/export.
- Lazy-load frontend feature modules.

## 9. Operations Review

### Strengths

- PM2 ecosystem config is clear and production-oriented.
- Docker is used for PostgreSQL and EMQX, which are appropriate service boundaries.
- Health endpoints exist for API and workers.
- Backup and restore scripts exist.
- Service management UI is admin-gated.
- Documentation is unusually strong: `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `GOTCHAS.md`, `ROADMAP.md`, `SKILL.md`, and `service_start.md`.

### Gaps

- Off-host backup remains pending.
- Restore drills need current evidence.
- Fast health and deep diagnostics should be separated.
- Deployment checklist should explicitly include firewall, EMQX auth smoke, CSP smoke, backup smoke, and worker-token checks.

## 10. Testing And QA Review

The current `node:test` suite is a good start because it avoids additional test-runner dependency and stays close to the actual runtime.

Current coverage is still too narrow for a commercial production platform.

Missing high-value tests:

- route auth/role integration tests;
- CSP header tests;
- media/snapshot unauthenticated denial tests;
- migration tests on fresh and existing schemas;
- worker health tests;
- ingester payload replay fixtures;
- report render smoke tests;
- frontend smoke tests for login, events, health, reports, and LINE settings.

## 11. Prioritized Technical Roadmap

| Priority | Work Item | Reason | Risk If Deferred |
|---|---|---|---|
| P0 | Self-host vendor JS and tighten CSP. | Removes browser supply-chain risk. | Enterprise security review may block deployment. |
| P0 | Add route/auth/static/CSP smoke tests. | Protects critical security boundaries. | Route refactors may open regressions silently. |
| P0 | Off-host backup and restore drill. | Makes recovery story credible. | Local disk loss can invalidate local backups. |
| P1 | Continue route-module extraction. | Reduces route-order and middleware drift risk. | `api-server.js` becomes harder to change safely. |
| P1 | Extract shared report/time/brand helpers. | Prevents drift between API and report worker. | Scheduled/on-demand report behavior can diverge. |
| P1 | Add EXPLAIN baselines and slow-query logs. | Gives evidence before events table grows. | Performance work becomes reactive under pressure. |
| P1 | Cache/split health diagnostics. | Reduces edge-machine I/O load. | Health page becomes a background load source. |
| P2 | Frontend module split and lazy loading. | Reduces parse cost and UI regression scope. | Dashboard monolith becomes harder to maintain. |
| P2 | Ingester payload replay library. | Protects multi-vendor support. | Vendor regressions require manual debugging. |

## 12. Final Technical Verdict

Vigil Platform has a strong engineering foundation for its current product category: single-tenant, on-prem, security operations, multi-vendor camera events, LINE alerting, and management reporting.

The right technical strategy is:

- keep the architecture;
- avoid framework rewrites;
- strengthen boundaries;
- increase automated coverage;
- reduce supply-chain risk;
- add operational recovery proof;
- benchmark the database before scale pressure arrives.

The system is technically credible, but its next stage should focus on guardrails and evidence rather than feature expansion alone.
