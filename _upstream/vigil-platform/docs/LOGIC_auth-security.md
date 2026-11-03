# LOGIC_auth-security — Authentication, Security & User Management

> Extracted from DECISIONS.md. Canonical source for all auth, session,
> RBAC, security-audit, and compliance decisions.
> Parent index: DECISIONS.md
> Last updated: 2026-06-08 · v1.5.0

---

## Authentication & Sessions (#6–#11, #127)

**#6 — Session-based auth, NOT JWT for user sessions**
Easier to revoke. JWT would require a denylist to achieve the same effect.

**#7 — bcryptjs (not native bcrypt)**
Pure JS, no native rebuild on macOS ARM. Cost factor 10.

**#8 — Triple-layer auth: Cookie + localStorage + URL hash**
Safari ITP blocks cookies on cross-origin requests and some same-site edge cases.
All three layers must coexist. Removing any one breaks Safari iOS.

> STUBBORN_FACT: Triple-layer auth must never be simplified to cookie-only. Decision #8.

**#9 — Force password change on first login**
Default `admin/changeme` must not survive past first session.

**#10 — 3 roles: admin / viewer / auditor**
- `admin` — full access
- `viewer` — read-only (UI hides `.admin-only` elements)
- `auditor` — read-only but sees admin pages (compliance/external reviewers). Added 2026-05-22. Migration 017.

**#11 — Audit log retention 90 days**
Balances compliance need vs. storage cost.

**#127 — Auditor role enforcement is server-side, not UI-only**
Global `app.use('/api', …)` middleware rejects any non-GET/HEAD from auditor with `403 {error:'read_only'}`. UI hiding is a UX convenience only — the server is the real guarantee.
`auth.requireAdminOrAuditor` replaced `requireAdmin` on admin GET routes auditors need.
Backup file download (`/api/backups/:filename`) keeps `requireAdmin` — a `.dump` is the whole DB.

**#140 — `auth.requireAuth/Admin/AdminOrAuditor` honor `req.internal`**
Global `/api` middleware sets `req.internal = true` when valid `X-Internal-Token` present (used by Puppeteer renderer calling its own data endpoints). Each guard short-circuits with `if (req.internal === true) return next()` before session check.

---

## Security Audit Fixes (#56–#61, #120, #129, #130)

**#56 — Static assets require auth**
`dashboard.js`, `index.html`, CSS, images — all denied to unauth users except an explicit PUBLIC allowlist (`PUBLIC_HTML_FILES`, `PUBLIC_PATHS`, `PUBLIC_PREFIXES` constants in `api-server.js`).

**#57 — `/snapshots/*` is auth-gated (PDPA)**
Replaced `express.static('/snapshots')` with a route that validates session. Regex blocks path traversal.

**#58 — `/api/config` requires auth**
Was leaking `MAPBOX_TOKEN` publicly. Rotate token if deployed before 2026-05-08.

**#59 — `/api/branding` stays public**
Login + disclaimer pages need brand info pre-auth. Returns only non-sensitive fields.

**#60 — Defense in depth for Mapbox token**
Full server-side proxy deferred. Current: only authed users see the token.

**#61 — Auth allowlist is centralised**
`PUBLIC_HTML_FILES`, `PUBLIC_PATHS`, `PUBLIC_PREFIXES` at top of `api-server.js` are the single source of truth. Adding a new public asset = add to the allowlist.

**#120 — Network-surface audit (2026-05-21): 6 issues fixed**
- HIGH: WebSocket broadcast was unauthenticated — `verifyClient` now rejects upgrades without valid session (cookie or `?token=`). Was a live PDPA breach.
- HIGH: `DELETE /api/alert-logs` had no admin gate — added.
- MEDIUM: CORS reflected ANY Origin → replaced with allowlist (`ALLOWED_ORIGINS` env).
- MEDIUM: `getIP()` reads `CF-Connecting-IP` (Cloudflare overwrites, unforgeable) then `req.ip` — never raw `X-Forwarded-For`.
- LOW: Per-IP login attempt Map pruned every 5 min; `/api/auth/me` no longer logs raw Cookie; password minimum 6→8 chars; `src/.env` chmod 600.

> STUBBORN_FACT: WebSocket connections require valid session — `verifyClient` gate is non-negotiable. GOTCHAS #36.
> STUBBORN_FACT: CORS is an allowlist, not blanket reflection. GOTCHAS #37.
> STUBBORN_FACT: Never read raw `X-Forwarded-For` for security decisions — use `getIP()`. GOTCHAS #38.

**#129 — LINE webhook X-Line-Signature HMAC-SHA256 verification**
Requires `express.raw({ type: 'application/json' })` — must receive raw bytes BEFORE JSON parse. Skipped silently if `channel_secret` not configured (backward-compat).
LINE onboarding behavior after verification is owned by `docs/LOGIC_line-notifications.md`.

> STUBBORN_FACT: Never use `express.json()` as body parser for HMAC-signed webhook routes.

**#130 — Heatmap `?hours` parameter clamped to minimum 1**
`Math.max(1, parseInt(hours, 10) || 24)` — prevents `INTERVAL '-0 hours'` Postgres error.

**#266 — Any cache keyed by user scope MUST use `scopeCacheKey()`** *(2026-09-06, GOTCHAS #190)*

`auth.scopeCacheKey(allowedSites)` (`src/auth.js:637`) is the **only** correct way to derive a
cache key from a caller's scope. Never hand-roll `allowedSites.join(',')`.

Why it is a security rule and not a style rule: `siteWhere()` builds its SQL from **two** axes —
the site list *and* the per-user camera list (`allowedSites.cameras`, decision #253). A key made
from sites alone collapses two users with the same site but different cameras onto **one cache
entry**, so the user restricted to 4 cameras gets back the 84-camera answer. Real sites 18/20.
It leaks across a permission boundary silently — no error, no log, correct-looking data.

```
scopeCacheKey(null)              → 'all'
scopeCacheKey([1,2])             → '1,2|*'      // no .cameras ⇒ unrestricted, matches siteWhere()
scopeCacheKey(sitesWithCameras)  → '1,2|c7,c9'
scopeCacheKey([])                → 'none|*'
```

Pure, never throws, sorts both lists so key order cannot vary. Current callers:
`stats-summary-route.js:123` · `routes/events.js:400` · `routes/appearances.js:230` ·
`routes/lpr-query.js:1023/1057` · `routes/hcp.js:490`.

**#S1 — `raw_json.rawXml` must be scrubbed for non-admin** *(security backlog 2026-08-12, owner-ordered; shipped 2026-09-06)*

Hikvision `anprAlarm` events carry the raw ISAPI XML in `raw_json.rawXml`, and that XML includes
the camera's `<ipAddress>`, `<ipv6Address>` and `<macAddress>` — i.e. the internal network map,
exposed to *everyone who can log in*. **Auditor counts as non-admin.**

`src/helpers/scrubRawJson.js` exports the pair that must stay in agreement:
- `scrubRawJson(rj)` — JS, pure, shallow copy, never throws. Use where rows are already objects.
- `scrubRawJsonSql(col)` — the SQL equivalent, for routes whose SELECT list is explicit.

**It masks the values, it does not drop the key** — `page-lpr.js` reads the seat-belt fields
(`pilotsafebelt` / `vicepilotsafebelt`) out of that same blob. Tag names are case-sensitive,
exactly as ISAPI sends them. Admins still get the unmasked payload for debugging.

Applied at 6 REST routes plus the WebSocket:

| Where | Call |
|---|---|
| `routes/events.js:79` | `scrubRawJson` per row |
| `routes/appearances.js:481` | `scrubRawJson` per row |
| `routes/lpr-query.js:367` | `scrubRawJsonSql` in the SELECT |
| `routes/lpr-alerts.js:83` | `scrubRawJsonSql` |
| `routes/lpr-watchlist.js:372` | `scrubRawJsonSql` |
| `routes/traffic.js:1067` | `scrubRawJsonSql` |
| `api-server.js:1802` (WS `broadcast`) | `scrubRawJson`, gated on `ws._isAdmin` |

The WS flag is **fail-closed**: `ws._isAdmin = req?._isAdmin === true`, so a missing flag means
non-admin. The `lite` broadcast variant needs no scrub — it only ever carries
`plate/region/gender/glass`.

> STUBBORN_FACT: a new route that returns `events.raw_json` to a non-admin needs one of these two
> helpers. Adding the route without it re-opens SEC-018.

---

## Compliance & Legal (#54, #55, #106)

**#54 — Mandatory disclaimer page**
Thai legal requirement: Computer Crime Act B.E. 2550 + PDPA awareness.

**#55 — Force re-acceptance per browser session**
Stronger legal posture than "accept once forever". `sessionStorage` flag tracks per-session acceptance.

**#106 — EULA acceptance is a hard blocker on first admin login**
Full Thai EULA blocks dashboard until admin ticks checkbox + clicks Accept. Viewers don't see this — only admins can legally bind the deployment. `eula_accepted_at` + `eula_accepted_by` recorded in `system_settings`.

---

## Audit Log

**Camera-targeted audit trail (migration 024, 2026-05-26)**
`audit_log.target_camera_id` records camera lifecycle/config actions independently from user-targeted audit columns. Current camera actions include add/edit/delete camera, offline-alert settings, and group assignment/removal. Details JSON redacts camera `username` / `password`.

Audit Log UI supports filtering by action and camera. Filter-aware CSV export is still optional polish, not part of the shipped core.

---

## Related files
- `src/auth.js` — implementation (incl. `siteWhere()` / `scopeCacheKey()`)
- `src/helpers/scrubRawJson.js` — `rawXml` network-field scrub (JS + SQL forms)
- `src/view-registry.js` — `WS_TYPE_ROUTE`, the view axis of the WS filter
- `db/db_migration_auth.sql` — users + sessions + audit_log schema
- `db/db_migration_024_camera_audit_log.sql` — camera-targeted audit column/index
- `db/db_migration_016_license.sql` — EULA fields
- `db/db_migration_017_*.sql` — auditor role
- GOTCHAS #2 (Safari ITP), #36–#38 (security audit)
