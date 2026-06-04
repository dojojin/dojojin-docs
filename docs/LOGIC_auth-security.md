# LOGIC_auth-security — Authentication, Security & User Management

> Extracted from DECISIONS.md. Canonical source for all auth, session,
> RBAC, security-audit, and compliance decisions.
> Parent index: DECISIONS.md
> Last updated: 2026-05-24 · v1.5.0

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
- `src/auth.js` — implementation
- `db/db_migration_auth.sql` — users + sessions + audit_log schema
- `db/db_migration_024_camera_audit_log.sql` — camera-targeted audit column/index
- `db/db_migration_016_license.sql` — EULA fields
- `db/db_migration_017_*.sql` — auditor role
- GOTCHAS #2 (Safari ITP), #36–#38 (security audit)
