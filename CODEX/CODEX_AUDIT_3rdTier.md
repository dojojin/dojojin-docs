# CODEX_AUDIT_3rdTier.md — Security / Performance / Sustainability Audit

> Audit date: 2026-06-07  
> Reviewer: Codex  
> Scope: current repository state after 2nd-tier remediation, focusing on security concern, performance, and sustainability.  
> Method: investigate-first review from source files, migration files, repo docs, and current git state. No `.env`, camera credential files, media, snapshots, reports, or customer data were inspected.

---

## 0. Executive Summary

### Overall Assessment

The system is materially stronger than the earlier audit rounds. The largest risks from the previous rounds are mostly closed or intentionally deferred:

- `/others/*` is no longer broadly public at runtime.
- media/snapshot/static dashboard assets remain auth-gated.
- role-based write controls are present for sensitive API groups.
- CSP is enforced for dashboard and `/others`.
- inline script/event-handler cleanup appears complete for dashboard.
- dependency stack has been upgraded and lockfile is tracked.
- PM2/process split and worker isolation reduce blast radius.
- backup/service admin routes use allowlists and `execFile`, not shell string execution.

The remaining 3rd-tier concerns are not mostly "missing basic controls"; they are about production hardening and scale:

1. **Security:** authenticated dashboard still trusts third-party JavaScript from `cdn.jsdelivr.net` while using bearer tokens in browser storage.
2. **Security:** EMQX MQTT port is intentionally exposed on all interfaces; auth is enabled, but network exposure should be explicitly controlled per deployment.
3. **Performance:** event/category analytics queries are likely to become the main DB bottleneck as `events` grows.
4. **Performance:** health details endpoint can become I/O heavy because it scans media/snapshot directories and shells out to PM2 frequently.
5. **Sustainability:** `src/api-server.js` and `dashboard/dashboard.js` remain very large, which makes route-order, auth, i18n, and UI regressions harder to control.
6. **Sustainability:** test coverage is still mostly unit-level; route/auth/CSP/migration smoke tests are the next high-value layer.

### Status Legend

| Status | Meaning |
|---|---|
| `Open` | Should be addressed. |
| `Deferred` | Valid issue, but can wait for planned refactor / scale threshold. |
| `Accepted risk` | Current behavior appears intentional; document and monitor. |
| `Guarded` | Existing guard exists, but follow-up hardening is recommended. |
| `Positive control` | Not a finding; records a control that reduces risk. |

---

## 1. Audit Evidence

### Files / Areas Reviewed

- `CODEX_AUDIT_2ndTier.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `microservice_plan.md`
- `docker-compose.yml`
- `ecosystem.config.js`
- `.gitignore`
- `.env.example`
- `src/package.json`
- `src/package-lock.json`
- `src/api-server.js`
- `src/auth.js`
- `src/report-worker.js`
- `src/alert-worker.js`
- `src/report-renderer.js`
- `src/stats-summary-route.js`
- `dashboard/index.html`
- `dashboard/dashboard.js`
- `dashboard/i18n.js`
- `dashboard/login.js`
- `dashboard/report-print.html`
- `public/others/*.html`
- `db/db_migration_*.sql`
- `db/MANUAL_partition_events_option_a.sql`
- `test/*.test.js`

### Important Current Facts

- Git working tree was clean before this audit document was created.
- Recent history includes second-tier audit status update and runtime dependency upgrade.
- `src/node_modules` exists locally but is not tracked by git.
- Postgres is bound to `127.0.0.1:5432`.
- EMQX MQTT is bound to `1883:1883` on all interfaces.
- EMQX dashboard is bound to `127.0.0.1:18083`.
- Runtime apps are split under PM2: `api-server`, `mqtt-subscriber`, `media-recorder`, `hikvision`, `dahua`, `report-worker`, `alert-worker`.
- `report-worker` listens on `127.0.0.1:3001` and requires `INTERNAL_API_SECRET`.
- `alert-worker` health endpoint listens on `127.0.0.1:3002` and exposes only health metadata.
- Dashboard loads OpenLayers / Chart.js / date adapter from `cdn.jsdelivr.net`.
- Dashboard auth token is stored in `localStorage` and `sessionStorage` by `dashboard/login.js`.
- `/others/*` is now auth-gated by default at runtime; `OTHERS_PUBLIC` is empty.
- `/vendor/`, `/branding/`, and `/tiles/` remain public static prefixes.
- `dashboard/dashboard.js` is about 10.6k lines.
- `src/api-server.js` is about 6.5k lines.
- Test suite currently covers helper/crypto/alert/color utility logic, not full API route behavior.

---

## 2. Security Findings

### Security Summary Table

| ID | Severity | Status | Area | Finding |
|---|---:|---|---|---|
| SEC-3T-001 | High | ✅ Done 2026-06-10 | Browser supply chain | Fixed: OL 9.2.4 + Chart.js 4.4.1 + date-fns adapter 3.0.0 vendored under `dashboard/vendor/`; zero third-party JS on authenticated pages; jsdelivr removed from CSP (dashboard + `/others`). |
| SEC-3T-002 | Medium | Accepted risk / Guarded | MQTT network surface | EMQX MQTT port binds all interfaces. Auth is enabled, but exposure is deployment-sensitive. |
| SEC-3T-003 | Medium | Accepted risk | Public static tiles | `/tiles/` remains public and may reveal site/map structure. |
| SEC-3T-004 | Medium | Guarded | Internal token | Internal-token bypass is strong but very high-trust; api-server fallback can cause silent integration failure. |
| SEC-3T-005 | Medium-Low | ✅ Done 2026-06-10 | CSP policy slack | jsdelivr removed from both CSP blocks (with SEC-3T-001). Inline `<style>` blocks extracted to external .css (index/login/disclaimer/report-print/vendor-comparison); `style-src-elem 'self'` enforced; `style-src-attr 'unsafe-inline'` retained intentionally (790 `style=""` usages in JS templates — element injection was the meaningful risk); bare `style-src` kept as legacy-browser fallback. |
| SEC-3T-006 | Medium-Low | Deferred / Guarded | Camera credential encryption | Plaintext fallback remains possible when `CAMERA_SECRET_KEY` is absent. |
| SEC-3T-007 | Low | Deferred | Session lifetime | 7-day bearer sessions are convenient but broad if browser storage is compromised. |
| SEC-3T-P01 | Positive | Positive control | Auth / static | Auth-gated media/snapshot/dashboard serving is preserved. |
| SEC-3T-P02 | Positive | Positive control | Admin operations | Backup/service routes use role checks, allowlists, and `execFile`. |
| SEC-3T-P03 | Positive | Positive control | Uploads | Branding upload checks role, size, MIME, magic bytes, and normalizes via `sharp`. |

---

### SEC-3T-001 — Third-Party Dashboard JavaScript With Browser-Stored Bearer Token

**Severity:** High  
**Status:** ✅ Done 2026-06-10 — dashboard JS/CSS vendored (`dashboard/vendor/ol/`, `dashboard/vendor/chartjs/`); CDN refs removed from `index.html` + `report-print.html`; CSP script-src/style-src cleaned. Verified: CSP header contains no jsdelivr; served vendor bytes identical to pinned upstream.  
**Area:** Browser supply chain / session protection

#### Fact

`dashboard/index.html` loads these runtime scripts/styles from `cdn.jsdelivr.net`:

- OpenLayers CSS/JS
- Chart.js
- `chartjs-adapter-date-fns`

`dashboard/report-print.html` also loads Chart.js from `cdn.jsdelivr.net`.

`dashboard/login.js` stores the bearer token in:

- `localStorage`
- `sessionStorage`

Dashboard CSP still allows:

- `script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com`
- `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`

#### Risk

If a CDN resource, CDN account, upstream package, DNS path, or injected dependency is compromised, malicious JavaScript executes inside an authenticated CCTV/security dashboard. Because the bearer token is available in browser storage, injected JS could steal it and call authenticated APIs.

This is a high-value target because the system controls security operations data, camera status, reports, LINE configuration, and administrative actions.

#### Recommendation

1. Self-host OpenLayers, Chart.js, and date adapter under `/vendor/`.
2. Pin exact versions in the repository or via a controlled vendoring script.
3. Remove `https://cdn.jsdelivr.net` from dashboard and report CSP after self-hosting.
4. If self-hosting must be deferred, add SRI hashes to all CDN tags and document a dependency update procedure.
5. Reconsider Cloudflare analytics on authenticated views if customer privacy / PDPA constraints require strict first-party operation.

#### Suggested Priority

Do this before expanding pilot/customer exposure. This is the strongest remaining security concern from this audit.

---

### SEC-3T-002 — EMQX MQTT Port Binds All Interfaces

**Severity:** Medium  
**Status:** Accepted risk / Guarded  
**Area:** MQTT network exposure

#### Fact

`docker-compose.yml` exposes MQTT as:

```yaml
ports:
  - "1883:1883"
```

The file also enables EMQX listener authentication:

```yaml
EMQX_LISTENERS__TCP__DEFAULT__ENABLE_AUTHN: "true"
```

The EMQX dashboard is safer and bound to localhost:

```yaml
- "127.0.0.1:18083:18083"
```

#### Risk

Binding MQTT to all interfaces is often necessary for cameras/edge devices, but it creates an externally reachable protocol surface. Even with MQTT auth enabled, this can invite brute-force attempts, noisy connects, resource pressure, or accidental exposure on networks where firewall assumptions drift.

#### Recommendation

1. For single-host or VPN-only deployments, bind MQTT to a specific LAN/VPN interface or `127.0.0.1` plus a local bridge.
2. If all-interface binding is required, document that the host firewall must restrict source IPs to camera/device networks.
3. Add an operational smoke test that anonymous publish/subscribe fails.
4. Monitor EMQX failed auth / connection bursts.
5. Keep EMQX dashboard localhost-only.

#### Suggested Priority

Keep as accepted risk only if deployment firewall rules are verified. Otherwise treat as open before external network rollout.

---

### SEC-3T-003 — Public `/tiles/` May Reveal Site/Map Structure

**Severity:** Medium  
**Status:** Accepted risk  
**Area:** Public static content

#### Fact

`src/api-server.js` public prefixes include:

```js
const PUBLIC_PREFIXES = ['/vendor/', '/branding/', '/tiles/'];
```

#### Risk

Public tiles can disclose floorplan/map/site structure even if cameras/media are protected. In a CCTV/security platform, site layout can be sensitive for some customers.

#### Recommendation

1. Decide per deployment whether map tiles are public, authenticated, or customer-public.
2. If tiles contain internal layout/floorplan details, gate them behind the same auth layer as dashboard assets.
3. If kept public, avoid putting sensitive overlays, camera positions, or internal labels in tile assets.

#### Suggested Priority

Customer/deployment policy decision. No immediate code change required if tiles are intentionally non-sensitive.

---

### SEC-3T-004 — Internal Token Bypass Is Correctly Guarded But High-Trust

**Severity:** Medium  
**Status:** Guarded  
**Area:** Service-to-service auth

#### Fact

`src/api-server.js` accepts internal-token bypass using `INTERNAL_API_SECRET` and timing-safe comparison.

`src/report-worker.js` exits if `INTERNAL_API_SECRET` is missing or too short.

`src/api-server.js` can fall back to a random internal secret when env is absent, which protects against accidental static bypass but can silently break service-to-service calls.

#### Risk

The internal token is a high-trust bearer secret. If exposed, it can bypass normal user auth for API/static requests designed to support worker operations. If missing/mismatched, worker flows may fail in ways that look like report or scheduler issues instead of config issues.

#### Recommendation

1. Treat `INTERNAL_API_SECRET` as a production-critical secret with rotation procedure.
2. Add a visible health warning when api-server is using fallback random internal secret.
3. Consider failing fast in production if `NODE_ENV=production` and `INTERNAL_API_SECRET` is absent/short.
4. Keep report-worker hard-fail behavior.

#### Suggested Priority

Medium. Existing guard is good; production observability should be stronger.

---

### SEC-3T-005 — CSP Still Has Policy Slack

**Severity:** Medium-Low  
**Status:** Open  
**Area:** CSP hardening

#### Fact

Dashboard CSP still permits external JS from `cdn.jsdelivr.net` and Cloudflare insights.

`/others` CSP also permits `https://cdn.jsdelivr.net`, even though reviewed `public/others/*.html` pages now appear to use local scripts.

`style-src 'unsafe-inline'` remains allowed.

#### Risk

The most important CSP concern is covered by SEC-3T-001. Beyond that, unnecessary CSP allowances reduce the value of CSP as a mitigation layer if another injection path appears later.

#### Recommendation

1. Remove unused CDN script allowances after self-hosting.
2. Split CSP by page group if `/others` does not need the same external policy as dashboard.
3. Gradually move inline styles to CSS files or nonce/hash-based policy for high-risk pages.

#### Suggested Priority

Pair with SEC-3T-001. Do not spend time on inline-style cleanup before removing third-party script trust.

---

### SEC-3T-006 — Camera Credential Encryption Has Plaintext Fallback

**Severity:** Medium-Low  
**Status:** Deferred / Guarded  
**Area:** Secret storage

#### Fact

Camera credential crypto helpers exist and tests cover crypto behavior. The system can warn when `CAMERA_SECRET_KEY` is absent, but compatibility fallback still exists for plaintext camera credentials.

`.gitignore` excludes camera config files from source control.

#### Risk

If a production deployment runs without `CAMERA_SECRET_KEY`, camera credentials can remain plaintext on disk. File-system compromise would expose camera passwords.

#### Recommendation

1. In production, require `CAMERA_SECRET_KEY` before accepting new/updated camera credentials.
2. Provide a migration/check command that reports plaintext credential entries without printing values.
3. Keep backward-compatible read fallback for existing installs until migration is complete.

#### Suggested Priority

Defer if current deployments are confirmed to have `CAMERA_SECRET_KEY`. Otherwise schedule before production hardening.

---

### SEC-3T-007 — Bearer Session Lifetime and Storage

**Severity:** Low  
**Status:** Deferred  
**Area:** Session security

#### Fact

`src/auth.js` uses a 7-day session TTL. Browser-side auth stores token in browser storage.

Session signature uses HMAC-SHA256 truncated to 32 hex characters, giving about 128-bit signature strength. That is acceptable cryptographic strength for this use case.

#### Risk

The main risk is not HMAC truncation. The main risk is that a stolen browser token remains useful for up to 7 days unless logout/secret rotation invalidates it.

#### Recommendation

1. Consider shorter idle timeout for admin sessions.
2. Consider step-up confirmation for high-impact admin actions.
3. Add session revocation UI or admin session list if user count grows.

#### Suggested Priority

Lower than SEC-3T-001. Revisit after browser supply-chain risk is reduced.

---

### SEC-3T-P01 — Positive Control: Auth-Gated Static and Media Paths

**Status:** Positive control

Important controls observed:

- `/snapshots/*`, `/media/*`, and dashboard static assets are auth-gated.
- `/others/*` is no longer broadly public by default.
- exact public prefixes are narrow and explicit.
- dotfiles are denied in static serving.

This directly addresses a major class of earlier exposure risk.

---

### SEC-3T-P02 — Positive Control: Admin Operations Use Safer Execution Patterns

**Status:** Positive control

Backup and service-management routes show good defensive patterns:

- admin/auditor role separation.
- write operations require admin.
- service names and actions are allowlisted.
- `execFile` is used instead of shell string interpolation.
- backup download validates filename shape.
- audit logging exists for backup downloads.

---

### SEC-3T-P03 — Positive Control: Branding Upload Is Constrained

**Status:** Positive control

Branding upload route has useful layered controls:

- admin-only route.
- 5 MB upload limit.
- MIME allowlist.
- magic-byte verification.
- SVG rejection.
- image normalization via `sharp`.

This is a strong pattern for future upload endpoints.

---

## 3. Performance Findings

### Performance Summary Table

| ID | Severity | Status | Area | Finding |
|---|---:|---|---|---|
| PERF-3T-001 | High-Medium | Deferred / Open at scale | Analytics SQL | Category/stats queries will likely become primary DB bottleneck as `events` grows. |
| PERF-3T-002 | Medium | Deferred | Events listing | `COUNT(*) OVER()`, deep `OFFSET`, and `ILIKE` free text will degrade at scale. |
| PERF-3T-003 | Medium | Open | Health endpoint | `/api/health/details` can become I/O heavy due to directory scans and PM2 shell calls. |
| PERF-3T-004 | Medium | Deferred | Frontend payload | Dashboard remains a very large single-page payload with CDN-loaded libraries. |
| PERF-3T-005 | Medium-Low | Guarded | Report rendering | Puppeteer serialization protects memory but can create queue latency. |
| PERF-3T-006 | Low-Medium | Positive / Monitor | Worker split | Worker isolation improves runtime stability; monitor cross-process failure modes. |
| PERF-3T-P01 | Positive | Positive control | DB / process | Pool sizing, worker isolation, partition plan, and index cleanup are good scale work. |

---

### PERF-3T-001 — Category / Stats Queries Are the Likely Scale Bottleneck

**Severity:** High-Medium  
**Status:** Deferred / Open at scale  
**Area:** Database analytics

#### Fact

`src/api-server.js` contains stats endpoints that compute:

- category counts
- category timeline
- per-camera category breakdown
- top-rules/category metrics
- current vs previous period comparisons

Several patterns join `events` with `event_category_rules` and use `COUNT(DISTINCT e.id)`.

`src/stats-summary-route.js` runs many parallel summary queries and caches executive summary output for 30 seconds.

`db/MANUAL_partition_events_option_a.sql` exists as a manual partition plan for large `events` tables.

#### Risk

These queries are acceptable for current/small data sizes, but can become expensive when `events` reaches hundreds of thousands or millions of rows. `COUNT(DISTINCT)`, time-window scans, rule joins, and category expansion can become the dashboard bottleneck.

#### Recommendation

1. Run `EXPLAIN (ANALYZE, BUFFERS)` against production-like data for:
   - category count
   - timeline by category
   - per-camera stats
   - executive summary
2. Define a row-count threshold for enabling partitioning.
3. Consider a materialized category-event mapping table if category matching becomes expensive.
4. Consider hourly/daily rollup tables for dashboard stats.
5. Keep the existing 30-second cache, but add cache hit/miss and query timing logs for the slowest stats endpoints.

#### Suggested Priority

Defer until real row count / query timing crosses threshold, but define the threshold now.

---

### PERF-3T-002 — Events Listing Pagination and Search Will Degrade at Scale

**Severity:** Medium  
**Status:** Deferred  
**Area:** Events API

#### Fact

`/api/events` uses server-side filtering and pagination. The query includes:

- `COUNT(*) OVER()` for total count.
- `ORDER BY event_time DESC`.
- `LIMIT` / `OFFSET`.
- optional free-text search using `ILIKE` across rule/camera/object/event fields.
- optional category filter via `EXISTS`.

#### Risk

This is a practical implementation for moderate data. At large offsets, `OFFSET` becomes increasingly expensive. `COUNT(*) OVER()` can force more work than the current page needs. `ILIKE '%term%'` can become scan-heavy without trigram/full-text indexing.

#### Recommendation

1. Keep current behavior for normal dashboard pages.
2. Add keyset/cursor pagination for deep browsing/export workflows.
3. Consider separate count endpoint or approximate count when data grows.
4. If free-text `q` is used operationally, add a generated search vector or trigram indexes after measuring real query plans.

#### Suggested Priority

Deferred until high event volume or slow query logs show impact.

---

### PERF-3T-003 — Health Details Endpoint Can Become I/O Heavy

**Severity:** Medium  
**Status:** Open  
**Area:** Health / filesystem / process status

#### Fact

`/api/health/details` collects broad runtime diagnostics. It performs work including:

- DB status/counts.
- directory size checks for snapshots/media.
- disk stat checks.
- worker health checks.
- PM2 process status via `pm2 jlist`.
- camera config inspection.

Dashboard health page refresh behavior has historically polled details regularly.

#### Risk

Directory-size scans become expensive as snapshots/media accumulate. PM2 shell calls are heavier than in-process cached state. Frequent polling can turn a diagnostic endpoint into background load, especially on small edge machines.

#### Recommendation

1. Cache expensive health details for 5-15 seconds.
2. Track media/snapshot size/count through retention jobs instead of scanning full trees per request.
3. Split fast health from deep diagnostics:
   - `/api/health/details` fast/cached
   - `/api/health/deep` admin-only/manual
4. Log health endpoint duration when it exceeds a threshold.

#### Suggested Priority

Open. This is a relatively contained optimization with good operational payoff.

---

### PERF-3T-004 — Large Frontend Payload and Monolithic Dashboard Script

**Severity:** Medium  
**Status:** Deferred  
**Area:** Frontend performance / maintainability

#### Fact

Approximate tracked file sizes:

- `dashboard/dashboard.js`: about 10.6k lines.
- `dashboard/index.html`: about 3.7k lines.
- `dashboard/i18n.js`: about 1.5k lines.

The dashboard also loads map/chart libraries from CDN.

#### Risk

A very large script increases parse time, makes regressions harder to isolate, and encourages unrelated code paths to share globals. Loading all dashboard capability up front can be wasteful for users who only need a subset of pages.

#### Recommendation

1. Split dashboard JavaScript by functional area while preserving vanilla JS architecture.
2. Lazy-load heavy map/report/chart code only when those pages are opened.
3. Self-host vendor libraries as part of SEC-3T-001.
4. Keep i18n parity checks in the split process.

#### Suggested Priority

Deferred. Do opportunistically when touching large UI areas; do not do a one-shot rewrite.

---

### PERF-3T-005 — Serialized Puppeteer Rendering Trades Memory Safety for Queue Latency

**Severity:** Medium-Low  
**Status:** Guarded  
**Area:** Reports / Puppeteer

#### Fact

`src/report-renderer.js` uses a browser reuse/pool pattern and serializes report rendering through a render tail/queue.

This is a good guard against edge-machine memory spikes.

#### Risk

Under concurrent manual exports and scheduled reports, serialization can create slow user-facing report generation or stale scheduled jobs.

#### Recommendation

1. Expose render queue length and oldest job age in health details.
2. Add a max queued render limit or backpressure response.
3. Log render duration by report type and output type.
4. Keep serialization unless real hardware can safely support concurrency.

#### Suggested Priority

Monitor first. Add observability before changing concurrency.

---

### PERF-3T-006 — Worker Split Improves Stability But Adds Cross-Process Dependencies

**Severity:** Low-Medium  
**Status:** Positive / Monitor  
**Area:** Runtime architecture

#### Fact

Alert and report scheduling are split out of `api-server`. PM2 runs dedicated processes. `report-worker` calls api-server with internal token for report operations.

#### Risk

The split improves isolation, but operational failures now include token mismatch, worker down, api-server down, loopback HTTP failure, or PM2 process drift.

#### Recommendation

1. Keep worker health surfaced in dashboard.
2. Alert when worker health is stale, not only when process is down.
3. Include internal-token/config mismatch in health warnings.

#### Suggested Priority

Continue current direction. This is mostly an observability follow-up.

---

### PERF-3T-P01 — Positive Control: Scale Work Already Started

**Status:** Positive control

Useful performance controls already present:

- PM2 process isolation.
- DB pool max and `application_name` work across processes.
- `events` partition plan exists.
- dead index cleanup migrations exist.
- report render queue protects memory.
- executive summary has a TTL cache.
- alert/report workers reduce api-server background load.

---

## 4. Sustainability Findings

### Sustainability Summary Table

| ID | Severity | Status | Area | Finding |
|---|---:|---|---|---|
| SUST-3T-001 | High-Medium | Open / Deferred by area | Code size | `api-server.js` and `dashboard.js` remain very large. |
| SUST-3T-002 | Medium | Open | Duplication | api-server/report-worker share copied helper logic. |
| SUST-3T-003 | Medium | Open | Tests | No integration smoke layer for auth, CSP, routes, migrations, worker health. |
| SUST-3T-004 | Medium | Deferred | DB operations | Events partitioning remains manual and needs operational threshold/checklist. |
| SUST-3T-005 | Medium | Open | Backups | Off-host backup copy remains pending on roadmap. |
| SUST-3T-006 | Low-Medium | Deferred | Design system | UI/design-system migration remains opportunistic and incomplete. |
| SUST-3T-P01 | Positive | Positive control | Docs / process | AGENTS/CLAUDE/DECISIONS/GOTCHAS provide strong continuity controls. |
| SUST-3T-P02 | Positive | Positive control | Dependency hygiene | Lockfile tracked, no tracked `node_modules`, runtime stack upgraded. |

---

### SUST-3T-001 — Core Files Remain Too Large for Comfortable Change Control

**Severity:** High-Medium  
**Status:** Open / Deferred by area  
**Area:** Maintainability

#### Fact

Approximate source size:

- `src/api-server.js`: about 6.5k lines.
- `dashboard/dashboard.js`: about 10.6k lines.

Some route extraction has already started, for example category routes were moved to `src/routes/categories.js`.

`microservice_plan.md` states opportunistic route extraction is the intended Phase 2 direction.

#### Risk

Large files increase:

- route-order mistakes.
- duplicated helper logic.
- auth/role middleware gaps.
- accidental i18n omissions.
- merge conflicts.
- difficulty writing focused tests.

#### Recommendation

1. Continue extracting API routes by bounded domain:
   - reports
   - backups/service management
   - health/details
   - stats
   - line config
2. Keep middleware/auth in shared helpers to avoid route-specific drift.
3. Split dashboard JS by page/domain, not by arbitrary utility categories.
4. Add tests around each extracted route group.

#### Suggested Priority

High for any area being actively changed. Avoid a broad rewrite; extract when touching the area.

---

### SUST-3T-002 — api-server / report-worker Helper Duplication

**Severity:** Medium  
**Status:** Open  
**Area:** Shared backend logic

#### Fact

`src/report-worker.js` contains copied helper logic from `api-server.js`, with comments noting helper code was not moved to avoid touching call sites.

#### Risk

Copied report/time/brand/schedule helpers can drift. Report scheduling bugs are especially costly because they may only appear during scheduled windows or LINE delivery paths.

#### Recommendation

1. Extract shared pure helpers into small modules:
   - `src/lib/report-schedule.js`
   - `src/lib/report-time.js`
   - `src/lib/branding.js`
2. Keep route handlers in their current files until helpers are shared safely.
3. Add unit tests around extracted helper behavior before moving call sites.

#### Suggested Priority

Medium. Good candidate for next sustainability cleanup because blast radius can be kept small.

---

### SUST-3T-003 — Test Coverage Needs Integration Smoke Layer

**Severity:** Medium  
**Status:** Open  
**Area:** Regression prevention

#### Fact

Current tracked tests are focused on:

- helper logic.
- camera credential crypto.
- alert engine.
- color utilities.

There is no obvious integration smoke layer for:

- route auth.
- role-gated writes.
- static media gating.
- CSP headers.
- migration execution.
- worker health endpoints.
- backup/service admin denial paths.

#### Risk

The most important system behaviors are currently protected mainly by manual audit and code review. As files are split and security hardening continues, route-order and middleware regressions are plausible.

#### Recommendation

Add a small smoke suite that starts the Express app in test mode or hits a local running app with seeded auth:

1. unauthenticated `/dashboard.js` denied or redirected as expected.
2. unauthenticated `/media/*` and `/snapshots/*` denied.
3. unauthenticated `/others/vendor-comparison.html` denied or redirected.
4. dashboard HTML includes expected CSP header.
5. auditor cannot write admin endpoints.
6. admin-only service route rejects non-admin.
7. backup download rejects unsafe filenames.
8. internal token can reach only intended worker/static paths.

#### Suggested Priority

High-value next step. This will make future route extraction safer.

---

### SUST-3T-004 — Events Partitioning Is Manual

**Severity:** Medium  
**Status:** Deferred  
**Area:** DB operations

#### Fact

`db/MANUAL_partition_events_option_a.sql` exists and documents a manual partition plan.

`CHANGELOG.md` notes partition work and related retention fixes.

#### Risk

Manual partitioning is reasonable for a production database, but operationally risky if the trigger threshold is unclear. Waiting too long can make migration slow; doing it casually can break ingest/report queries.

#### Recommendation

1. Document a row-count and table-size threshold for partition activation.
2. Add a dashboard/health warning when `events` exceeds threshold.
3. Add a dry-run checklist:
   - backup complete.
   - migration lock window.
   - EXPLAIN baseline captured.
   - ingest paused or expected throughput documented.
   - rollback plan.
4. Keep partitioning manual until tested on a production-like copy.

#### Suggested Priority

Deferred until data volume justifies it, but threshold/checklist should be written soon.

---

### SUST-3T-005 — Off-Host Backup Copy Remains Pending

**Severity:** Medium  
**Status:** Open  
**Area:** Disaster recovery

#### Fact

`ROADMAP.md` includes off-host backup copy as pending/deferred work.

Current backup routes and scripts appear to handle local backup creation/download.

#### Risk

Local backup alone does not protect against host disk failure, theft, ransomware, or accidental full-host deletion.

#### Recommendation

1. Add an off-host backup target:
   - S3-compatible object storage.
   - NAS over VPN.
   - customer-approved secure storage.
2. Encrypt backups before upload if storage is outside the host.
3. Add backup restore drill documentation.
4. Surface latest local and off-host backup timestamps in health/details.

#### Suggested Priority

Open. This is operationally important before relying on the system for long-term customer data.

---

### SUST-3T-006 — Design-System Migration Is Still Opportunistic

**Severity:** Low-Medium  
**Status:** Deferred  
**Area:** UI consistency / report safety

#### Fact

Docs define a design-token and inline-SVG direction. Existing dashboard still has legacy UI patterns and some grandfathered emoji/inline styling areas.

The Health Report PNG path has a known no-emoji constraint due to `sharp`/librsvg/Pango behavior.

#### Risk

Inconsistent UI patterns can make future changes slower and can accidentally violate report-rendering constraints if server-side SVG templates add emoji or unsupported glyphs.

#### Recommendation

1. Continue opportunistic migration when touching each UI area.
2. Keep no-emoji rule strict for server-side SVG report templates.
3. Add lightweight static checks for:
   - Thai text without i18n marker in dashboard files.
   - emoji in report SVG templates.
   - hardcoded colors in new UI surfaces.

#### Suggested Priority

Deferred. Handle during UI/report changes.

---

### SUST-3T-P01 — Positive Control: Strong Project Memory

**Status:** Positive control

The repo has unusually strong operational memory:

- `AGENTS.md`
- `CLAUDE.md`
- `ARCHITECTURE.md`
- `DECISIONS.md`
- `GOTCHAS.md`
- `ROADMAP.md`
- `SKILL.md`
- `service_start.md`
- `CODEX_AUDIT_*.md`

This reduces repeated mistakes and is a meaningful sustainability control.

---

### SUST-3T-P02 — Positive Control: Dependency Hygiene Improved

**Status:** Positive control

Observed controls:

- `src/package-lock.json` is tracked.
- local `src/node_modules` is not tracked.
- runtime package stack has been upgraded recently.
- root package has no broad runtime dependency surface.

Follow-up remains: remove CDN runtime JS from dashboard and bring browser dependencies under the same controlled update process.

---

## 5. Recommended Action Plan

### Priority 1 — Security Hardening Before Wider Exposure

| ID | Action | Owner Type | Notes |
|---|---|---|---|
| SEC-3T-001 | Self-host dashboard/report vendor JS and remove jsdelivr from CSP. | Code | Highest remaining security concern. |
| SEC-3T-002 | Verify firewall/source restrictions for MQTT `1883`. | Ops | Keep all-interface bind only if deployment requires it. |
| SEC-3T-004 | Add production health warning/fail-fast for missing `INTERNAL_API_SECRET`. | Code/Ops | Prevent silent worker breakage. |
| SUST-3T-003 | Add route/auth/static/CSP smoke tests. | Code | Protects future refactors. |

### Priority 2 — Operational Scale Guards

| ID | Action | Owner Type | Notes |
|---|---|---|---|
| PERF-3T-003 | Cache/split `/api/health/details` expensive checks. | Code | Small change with edge-machine payoff. |
| PERF-3T-001 | Capture EXPLAIN baselines for stats/category endpoints. | Code/Ops | Needed before optimizing. |
| SUST-3T-004 | Define partition threshold and checklist. | Ops/Docs | Avoid late partition migration pain. |
| SUST-3T-005 | Implement off-host backup copy. | Ops/Code | Disaster recovery gap. |

### Priority 3 — Sustainability Refactor

| ID | Action | Owner Type | Notes |
|---|---|---|---|
| SUST-3T-001 | Continue route extraction from `api-server.js`. | Code | Opportunistic, per domain. |
| SUST-3T-002 | Extract report/time/brand shared helpers. | Code | Start with pure helpers + tests. |
| PERF-3T-004 | Split/lazy-load dashboard modules. | Code | Keep vanilla JS, no framework rewrite. |
| SUST-3T-006 | Continue design-token/i18n cleanup when touching UI. | Code | Avoid broad sweep. |

---

## 6. What Appears Closed From Earlier Rounds

| Earlier Area | Current Assessment |
|---|---|
| `/others/*` public exposure | Runtime is default-deny/auth-gated; public exact list is empty. |
| Media/snapshot auth | Auth-gated static path remains in place. |
| Dashboard inline scripts/handlers | Current CSP direction and changelog indicate cleanup completed. |
| Admin write gating | Broad admin middleware exists for sensitive route groups. |
| Backup command injection risk | Uses admin role, filename validation, and `execFile`. |
| Service-management command injection risk | Uses admin role, allowlisted service/action, and `execFile`. |
| Upload SVG/script risk | Branding route rejects SVG and validates magic bytes. |
| Runtime stack CVEs from old deps | Recent dependency upgrade and lockfile tracking completed. |
| Worker blast radius | Alert/report background work split from api-server. |

---

## 7. Explicit Deferred / Accepted Risks

| Risk | Status | Why Not Immediate |
|---|---|---|
| `/tiles/` public | Accepted risk | Depends on whether tiles contain sensitive floorplan/site data. |
| Full events partitioning | Deferred | Manual plan exists; should trigger at data-size threshold. |
| Dashboard JS/module split | Deferred | Useful but should be done incrementally, not by rewrite. |
| Design-system legacy cleanup | Deferred | Existing legacy UI is grandfathered; fix when touching. |
| Session lifetime reduction | Deferred | Lower priority than eliminating third-party JS trust. |
| Camera plaintext fallback | Deferred / Guarded | Compatibility risk; production should verify `CAMERA_SECRET_KEY`. |

---

## 8. Validation Performed For This Audit

### Source Inspection

Manual source review was performed across the files listed in section 1.

### Local Static Facts Checked

- git status before audit document creation.
- recent commit history.
- tracked source file sizes.
- tracked dependency metadata.
- tracked test files.
- static route/CSP/auth patterns.
- worker/process topology.
- Docker port bindings.
- migration and partition files.

### Not Validated In This Audit

These were not executed as part of source inspection and should be validated separately before closing findings:

- real production firewall rules.
- real EMQX anonymous publish rejection.
- real `EXPLAIN ANALYZE` on production-sized `events`.
- real browser CSP behavior under all dashboard pages.
- real backup restore drill.
- real off-host backup status.
- real customer sensitivity classification of `/tiles/`.

---

## 9. Closure Criteria

### To Close SEC-3T-001

- OpenLayers/Chart.js/date adapter are served from local `/vendor/` or equivalent first-party path.
- dashboard and report HTML contain no `https://cdn.jsdelivr.net` runtime JS.
- dashboard/report CSP removes `https://cdn.jsdelivr.net` from `script-src`.
- smoke test confirms dashboard/report still render maps/charts.

### To Close SEC-3T-002

- deployment firewall/source IP restriction for `1883` is documented, or bind address is narrowed.
- anonymous MQTT connect/publish/subscribe rejection is tested.
- EMQX failed-auth monitoring is documented.

### To Close PERF-3T-003

- expensive directory/PM2 health checks are cached or moved to deep diagnostics.
- endpoint duration is measured before/after.
- dashboard health page still shows necessary status.

### To Close SUST-3T-003

- automated smoke tests cover auth-gated static assets, `/others`, media/snapshots, CSP headers, admin write denial, backup filename rejection, and service route role denial.
- tests run in CI/local command without requiring customer secrets.

### To Close SUST-3T-005

- off-host backup copy is implemented.
- restore drill is documented.
- health/details or admin UI exposes last successful local/off-host backup timestamp.

---

## 10. Final Opinion

This codebase is past the "basic audit cleanup" stage. The important remaining work is production hardening:

1. remove third-party runtime JavaScript from authenticated pages;
2. make network exposure and backup assumptions explicit;
3. add integration smoke tests around security boundaries;
4. define DB scale thresholds before `events` growth forces emergency optimization;
5. continue incremental route/UI extraction instead of a broad rewrite.

The recommended next concrete patch is **self-hosting dashboard vendor JavaScript and tightening CSP**, followed by **route/auth/CSP smoke tests**. Those two changes reduce the largest remaining security risk and make future hardening safer.
