# CODEX_AUDIT_2ndTier.md — Security-first Audit

> Audit date: 2026-06-03
> Reviewer: Codex
> Repository: `vigil-platform`
> Scope: static source review, selected local runtime probes, documentation
> consistency review, security-first risk assessment. No secrets were printed.

---

## Executive Summary

**Fact:** The previous Codex concerns in `CODEX_SUGGESTION.MD` are no longer the
main open risks. The old Docker/EMQX exposure concern is fixed in the current
tree, and the stale first-audit findings have been reclassified as closed or
accepted debt.

**Fact:** The most important current security concern is now browser-origin risk:
`/others` is public same-origin static HTML, several pages load third-party
scripts/CDNs and inline JavaScript, while the authenticated dashboard stores a
bearer session token in `localStorage`/`sessionStorage` for Safari ITP fallback.
A compromised CDN script, malicious public page change, or XSS in any same-origin
public page can read that token and call authenticated APIs as the user.

**Fact:** Core backend controls are materially better than the first audit:
auth-gated media/snapshots, raw LINE webhook verification, localhost-bound DB,
EMQX auth, service action allowlists, backup audit logging, map tile limits, and
upload magic-byte validation are present.

**Opinion:** Treat the `/others` same-origin issue as the highest-priority fix
before wider exposure. It is not just "public marketing pages"; it shares the
same origin and browser storage namespace as the CCTV dashboard.

---

## Scope And Method

Reviewed:

- `CODEX_SUGGESTION.MD`
- `src/api-server.js`
- `src/auth.js`
- `src/crypto-creds.js`
- `src/package.json`
- root `package.json`
- `.gitignore`
- `docker-compose.yml`
- `dashboard/login.html`
- `dashboard/dashboard.js`
- `public/others/**`
- `README.md`
- `service_start.md`
- `DECISIONS.md`
- `GOTCHAS.md`
- `ROADMAP.md`

Commands/probes used:

- `git status --short`
- `git ls-files ...`
- `git status --short --ignored package-lock.json src/package-lock.json`
- `rg` searches for auth, static mounts, third-party scripts, error returns,
  package locks, PM2/startup drift, and sensitive public routes.
- Local HTTP probe:
  - `GET http://127.0.0.1:3000/others/`
  - `GET http://127.0.0.1:3000/others/.DS_Store`
  - `GET http://127.0.0.1:3000/api/auth/me`

Not performed:

- No authenticated penetration test.
- No dependency vulnerability scan against the network registry.
- No secret inspection.
- No full browser XSS exploit PoC.
- No load/performance test.
- No production network scan.

---

## Previous Audit Closure

| Previous ID | Result | Notes |
|---|---:|---|
| Sec-1 LINE raw body | Closed | Raw body is preserved through `express.json({ verify })` for LINE webhook signature verification. |
| Sec-2 Docker ports | Closed | Postgres and EMQX dashboard are localhost-bound; MQTT is localhost + configured camera LAN IP; EMQX TCP authn is enabled; WS port is no longer exposed. |
| Sec-3 Credential docs | Closed | Previous tracked credential context was removed/redacted. |
| Sec-4 Security headers | Closed baseline | Headers exist. CSP enforcement remains open as a second-tier hardening item. |
| Sec-5 `/others` broad prefix | Closed prefix bug | Prefix is now strict `/others/`. Same-origin public-script risk remains separate and higher value. |
| Sec-6 Map tile bounds | Closed | Bounds/zoom/tile-count validation exists. |
| Sec-7 Backup audit | Closed | Backup downloads are audit logged. |
| Maint-1 Stale diff files | Closed | No tracked diff/patch files found in recheck. |
| Maint-2 ROADMAP stale items | Closed | Relevant items marked complete. |
| Maint-3 Mosquitto doc drift | Closed for Mosquitto | New PM2/startup drift found separately. |
| Maint-4 Root license | Closed | Root license is `UNLICENSED`. |
| Maint-5 Large API server | Accepted debt | Still large, but refactor should be incremental. |

---

## Findings Summary

| ID | Severity | Area | Status | Finding |
|---|---:|---|---|---|
| SEC-2T-001 | High | Browser/session | Open | Public same-origin `/others` pages load third-party scripts while dashboard bearer token is in browser storage. |
| SEC-2T-002 | Medium | Browser hardening | Open | CSP is Report-Only and still allows inline scripts. |
| SEC-2T-003 | Medium | Supply chain | Open | `package-lock.json` exists locally but is ignored/untracked; installs are not reproducible from Git. |
| SEC-2T-004 | Medium | API error handling | Open | Many routes return raw `err.message` / `e.message` to authenticated clients. |
| SEC-2T-005 | Low-Medium | Access control / privacy | Review | `GET /api/line-config` exposes masked LINE config plus recipient roster to any authenticated role. |
| SEC-2T-006 | Low | Credential hardening | Accepted risk / improve | Camera credential encryption tolerates plaintext fallback if `CAMERA_SECRET_KEY` is missing. |
| SEC-2T-007 | Low | Public static hygiene | Open | `.DS_Store` files exist under public trees; local probe did not serve `/others/.DS_Store`, but cleanup/deploy hygiene should remove them. |
| SEC-2T-008 | Low | Public surface | Review | `/tiles/` is public; acceptable if map cache is non-sensitive, risky if tile coverage reveals site location. |
| OPS-2T-001 | Medium | Operations docs | Open | `README.md` and `service_start.md` still tell operators to use `npm run start:all`, which now only prints a PM2 warning. |
| DB-2T-001 | Medium | Migration safety | Guard | Future large-table indexes must keep using the documented concurrent/manual path to avoid production locks. |
| MAINT-2T-001 | Medium | Maintainability | Accepted debt | `src/api-server.js` remains monolithic, increasing regression risk for security changes. |

---

## Detailed Findings

### SEC-2T-001 — Public same-origin `/others` pages can become token-exfiltration surface

Severity: **High**

Status: **Open**

Evidence:

- `src/api-server.js` public allowlist includes exact `/others` and strict
  `/others/` public prefix.
- `src/api-server.js` serves `public/others` through `express.static(...)`.
- `dashboard/login.html` stores `bosch_session_token` in `localStorage` and
  `sessionStorage`.
- `dashboard/dashboard.js` reads `bosch_session_token` and adds
  `Authorization: Bearer <token>` to API requests.
- `public/others/index.html` loads EmailJS from `cdn.jsdelivr.net`.
- `public/others/boxbox-th.html` and `public/others/boxbox-en.html` load
  Cytoscape/Dagre libraries from `cdn.jsdelivr.net`.
- `public/others/vss_v1.html` loads Materialize from `cdnjs.cloudflare.com`.
- Several `/others` pages use inline scripts and inline event handlers.
- Local probe confirmed `/others/` is unauthenticated and returns `200 OK`.

Risk:

- JavaScript on `/others` runs under the same origin as the authenticated
  dashboard.
- Same-origin JavaScript can read `localStorage` and `sessionStorage`.
- If a third-party CDN script is compromised, or if any `/others` page gets an
  XSS/content injection bug, the attacker can steal `bosch_session_token`.
- Once the token is stolen, the attacker can call authenticated APIs with the
  victim's role. Admin token compromise is critical because this system controls
  CCTV, LINE alerts, backups, service management, and configuration.

Why this is more serious than the old `/others` prefix issue:

- The old issue was URL matching breadth.
- The current issue is origin isolation. Even with strict `/others/` prefix,
  public pages still share the dashboard's storage namespace.

Recommendation:

1. Best fix: move public marketing/proposal/docs pages to a different origin,
   such as `public.example.com` or static hosting, separate from the dashboard
   origin.
2. If same host must stay: mount public pages on a separate hostname via reverse
   proxy and do not share cookies/storage origin.
3. If `/others` must remain same-origin temporarily: remove third-party scripts,
   self-host vetted assets, remove EmailJS browser dependency, and enforce a
   strict route-specific CSP for `/others`.
4. Long-term: reduce reliance on `localStorage` bearer tokens if possible, but
   do not break the current Safari ITP auth decision casually. Any auth redesign
   must respect the existing multi-layer auth constraints.

Suggested priority: **P0/P1 before external exposure**.

---

### SEC-2T-002 — CSP is Report-Only and allows inline scripts

Severity: **Medium**

Status: **Open**

Evidence:

- `src/api-server.js` sets `Content-Security-Policy-Report-Only`, not enforced
  `Content-Security-Policy`.
- `script-src` includes `'unsafe-inline'`.
- `style-src` includes `'unsafe-inline'`.
- Dashboard and public HTML currently rely on inline scripts/styles/handlers, so
  immediate strict enforcement may break pages.

Risk:

- CSP currently observes but does not block script execution.
- Inline script allowance means CSP does not materially reduce XSS impact.
- This matters more because the dashboard token is stored in browser storage.

Recommendation:

1. Split CSP by surface:
   - Authenticated dashboard: strictest possible policy.
   - Public `/others`: ideally separate origin; if not, separate route CSP.
2. Move inline dashboard scripts/event handlers into static JS files or use
   nonces/hashes.
3. Remove third-party scripts from same-origin public pages or self-host them.
4. Switch from Report-Only to enforced CSP after staged testing.

Suggested priority: **P1 after `/others` origin decision**.

---

### SEC-2T-003 — Dependency installs are not reproducible from Git

Severity: **Medium**

Status: **Open**

Evidence:

- `package-lock.json` and `src/package-lock.json` exist in the working tree.
- `git status --short --ignored package-lock.json src/package-lock.json` shows
  both as ignored.
- `git ls-files package-lock.json src/package-lock.json` does not list them.
- `.gitignore` ignores `package-lock.json`.
- `src/package.json` uses caret dependency ranges such as `^5.2.1`, `^24.43.1`,
  and `^0.34.5`.

Risk:

- A fresh clone or CI run cannot reproduce the exact dependency graph used on
  this machine.
- Production redeploys can silently pick newer transitive versions.
- Security fixes and security regressions become harder to audit because there
  is no committed dependency lock baseline.

Recommendation:

1. Commit `src/package-lock.json` for runtime dependencies and use `npm ci`.
2. Consider committing root `package-lock.json` if the root package is actually
   used; otherwise remove root Node dependency workflow.
3. Keep `scripts/keygen/package-lock.json` ignored only if that tool is truly
   standalone/operator-local.
4. Add a lightweight dependency audit step to the release checklist. Network
   scans should be explicit because this repo is production/security sensitive.

Suggested priority: **P1/P2**.

---

### SEC-2T-004 — API routes return raw error messages to clients

Severity: **Medium**

Status: **Open**

Evidence:

- `rg` found many `res.status(500).json({ error: err.message })` and
  `res.status(500).json({ error: e.message })` patterns in `src/api-server.js`.
- Most routes are authenticated, but some are admin or auditor-readable and can
  still expose filesystem paths, SQL internals, upstream API failures, or
  implementation details.

Risk:

- Error messages can reveal internal table/column names, file paths, config
  assumptions, or upstream endpoint behavior.
- This increases post-auth recon value after viewer/auditor/admin compromise.
- It makes external API behavior inconsistent and harder to safely monitor.

Recommendation:

1. Add a small helper for route errors:
   - log full error server-side with route/action context.
   - return stable client messages such as `internal_error`, `bad_request`, or
     domain-specific codes.
2. Keep detailed validation messages only where they are intentionally
   user-actionable and do not leak internals.
3. Prioritize backup, settings, line-config, map, service, media, and report
   routes first.

Suggested priority: **P2**.

---

### SEC-2T-005 — LINE config recipient roster is readable by any authenticated role

Severity: **Low-Medium**

Status: **Review**

Evidence:

- Global `/api` middleware requires authentication for `/api/line-config`.
- `requireAdminForWrites('/')` makes non-GET methods admin-only.
- `GET /api/line-config` is available to any authenticated user.
- Response masks tokens/secrets but returns `recipients`, `_hasToken`,
  `_hasSecret`, `_hasImgbb`, and LINE OA metadata.
- Dashboard code uses this endpoint to populate report schedule and alert
  recipient pickers.

Risk:

- LINE recipient IDs/names can be operationally sensitive.
- A viewer/auditor role may not need to know the full recipient roster.
- This is not token leakage because secrets are masked, but it is privacy and
  least-privilege exposure.

Recommendation:

1. Decide role policy explicitly:
   - If viewers need recipient pickers, accept and document.
   - If only admins/auditors should see LINE roster, restrict the endpoint.
2. Consider a separate redacted `GET /api/line-recipients` endpoint for UI
   pickers with only fields required by the role.

Suggested priority: **P3 unless customer privacy policy is strict**.

---

### SEC-2T-006 — Camera credential encryption still has plaintext fallback

Severity: **Low**

Status: **Accepted risk / improve**

Evidence:

- `src/crypto-creds.js` uses AES-256-GCM for `enc:v1:` credential values.
- `decryptCred()` intentionally passes plaintext values through for incremental
  migration.
- `encryptCred()` warns and returns plaintext if `CAMERA_SECRET_KEY` is missing.

Risk:

- If an operator saves camera credentials while `CAMERA_SECRET_KEY` is missing,
  new values can be stored as plaintext.
- This appears intentional for migration compatibility, but it is a production
  hardening gap after migration is complete.

Recommendation:

1. Add a health warning if any camera credential remains plaintext.
2. After deployment migration, add a config flag such as
   `CAMERA_CREDENTIAL_ENCRYPTION_REQUIRED=true` that blocks saving plaintext
   credentials when the key is missing.
3. Keep tolerant read path if required for rollback, but make new writes strict
   in production mode.

Suggested priority: **P3**.

---

### SEC-2T-007 — Public-tree `.DS_Store` files exist but were not served in local probe

Severity: **Low**

Status: **Open hygiene**

Evidence:

- Local files found:
  - `./.DS_Store`
  - `./public/.DS_Store`
  - `./public/others/.DS_Store`
  - `./scripts/.DS_Store`
  - `./src/.DS_Store`
- Local HTTP probe to `/others/.DS_Store` returned `404 Not Found`, so the
  current Express static behavior did not serve it.

Risk:

- Low direct risk based on local probe.
- Still poor deployment hygiene. Hidden OS metadata files should not sit inside
  public/static trees.

Recommendation:

1. Remove `.DS_Store` files from the workspace/deploy artifact.
2. Add `.DS_Store` to `.gitignore`.
3. Consider explicitly setting `dotfiles: 'ignore'` or `dotfiles: 'deny'` on
   public `express.static` mounts for clarity.

Suggested priority: **P3**.

---

### SEC-2T-008 — Public `/tiles/` cache may reveal map coverage

Severity: **Low**

Status: **Review / accept or gate**

Evidence:

- `PUBLIC_PREFIXES` includes `/tiles/`.
- Comments describe cached map tiles as non-sensitive.

Risk:

- If deployment location is sensitive, public tile paths and cache coverage can
  reveal approximate monitored areas.
- If map tiles are generic/offline cache only and filenames are not enumerated,
  risk may be acceptable.

Recommendation:

1. Confirm whether site geography is considered sensitive for each customer.
2. If sensitive, auth-gate `/tiles/` or serve map tiles through an authenticated
   route.
3. If accepted, document `/tiles/` as intentionally public static cache.

Suggested priority: **P3**.

---

### OPS-2T-001 — PM2/startup documentation drift

Severity: **Medium**

Status: **Open**

Evidence:

- `src/package.json` now makes `start:all` and `start:full` print a PM2
  management warning instead of starting services.
- `DECISIONS.md` #198/#199 says PM2 is the production daemon manager.
- `README.md` still contains `npm run start:all` operator commands.
- `service_start.md` still says the old path is usable and repeats
  `npm run start:all` / `start:full` in multiple sections.

Risk:

- Operators following docs may think services started when they did not.
- During incident response this can delay recovery or create conflicting process
  assumptions.
- This is operational, not a direct code vulnerability, but process confusion is
  a real availability risk.

Recommendation:

1. Update `README.md` and `service_start.md` to make `./scripts/services.sh`
   and PM2 the only normal start/stop/restart path.
2. Keep `npm run start:all` documented only as deprecated/no-op if mentioned at
   all.
3. Add a short "PM2 migration complete" note near old development commands.

Suggested priority: **P2**.

---

### DB-2T-001 — Future large-table indexes can still lock production if not handled carefully

Severity: **Medium**

Status: **Guard**

Evidence:

- `GOTCHAS.md` already documents production lock incidents and migration
  constraints.
- Some migration comments acknowledge manual/concurrent index needs.

Risk:

- Future migrations on `events`, `camera_status_log`, `alert_logs`, or report
  history tables can block production if regular `CREATE INDEX` is used inside a
  transaction on large existing tables.

Recommendation:

1. Keep the documented concurrent/manual pattern for large-table indexes.
2. Add migration review checklist item: "large table index? CONCURRENTLY path?"
3. Prefer preflight row-count checks for high-volume tables.

Suggested priority: **P2 for future schema work**.

---

### MAINT-2T-001 — `src/api-server.js` remains a large security-sensitive file

Severity: **Medium**

Status: **Accepted debt**

Evidence:

- `src/api-server.js` contains auth, static serving, camera config, map, LINE,
  reports, branding, backup, service management, health, media, and background
  job logic.

Risk:

- Security fixes are more likely to create route-order regressions.
- Middleware ordering is hard to reason about.
- Error handling is duplicated.

Recommendation:

1. Do not perform a large rewrite.
2. Extract route groups only when actively touching that subsystem.
3. Start with low-risk shared helpers:
   - response/error helper
   - public/static route policy helper
   - role-policy helper
4. Add smoke checks before each extraction.

Suggested priority: **P3, incremental only**.

---

## Positive Controls Verified

| Area | Verified control |
|---|---|
| API auth | Global `/api` auth gate exists, with public exceptions for login/logout/me, LINE webhook, branding, and EULA. |
| Static auth | Dashboard HTML/JS/CSS assets are auth-gated unless explicitly allowlisted. |
| Media/snapshots | `/snapshots/:filename` and `/media/:filename` are auth-gated and filename restricted. |
| WebSocket | WS `verifyClient` accepts cookie or token and verifies via `auth.getUserFromToken`. |
| LINE webhook | Raw body is preserved before JSON parsing and used for signature verification. |
| Docker network | Postgres and EMQX dashboard are localhost-bound; MQTT is limited to localhost plus camera LAN IP; EMQX TCP authn is enabled. |
| Map downloads | Lat/lng/zoom/tile-count validation exists before cache download jobs. |
| Backups | Backup download is admin-only and audit logged. |
| Branding upload | Logo upload is admin-only, rejects SVG, and validates magic bytes before `sharp`. |
| Service Management | Service actions use PM2, allowlisted service names/actions, and block api-server self-stop/start. |
| Default password | Auth layer supports default admin `must_change_password` gate. |
| Camera credential encryption | AES-256-GCM support exists for camera credentials with `enc:v1:` format. |

---

## Recommended Remediation Order

1. **P0/P1 — Isolate `/others` from dashboard origin.** Move public pages to a
   separate host/origin or auth-gate them. Remove third-party JS from same-origin
   public pages if separation cannot be done immediately.
2. **P1 — CSP hardening.** Split public/authenticated CSP policy, remove inline
   scripts where feasible, then enforce CSP instead of Report-Only.
3. **P1/P2 — Commit runtime lockfile.** Stop ignoring the runtime
   `src/package-lock.json`; use `npm ci` for deploy/release.
4. **P2 — Sanitize API error responses.** Introduce a small route error helper
   and prioritize sensitive endpoints first.
5. **P2 — Fix PM2 documentation drift.** Update `README.md` and
   `service_start.md` so operators do not use disabled `npm run start:all`.
6. **P3 — Public/static hygiene.** Remove `.DS_Store`, add ignore rule, and make
   static dotfile handling explicit.
7. **P3 — Least-privilege review.** Decide if non-admin users should see LINE
   recipient roster and public `/tiles/` cache.

---

## Validation Notes

Validated:

- Previous audit findings were rechecked against current source.
- Docker/EMQX current configuration was inspected.
- Local `/others/` route is public and returns content.
- Local `/others/.DS_Store` route returned `404`, so the discovered `.DS_Store`
  was not served in that probe.
- Local `/api/auth/me` without credentials returned `401`.
- `package-lock.json` and `src/package-lock.json` are ignored/untracked.
- PM2/startup documentation drift was confirmed by source search.
- Upload magic-byte validation exists for branding logo upload.

Not validated:

- Authenticated role-by-role API behavior in browser.
- Actual CDN compromise/XSS exploit.
- Registry dependency vulnerability state.
- Production network/firewall exposure beyond inspected compose config.
- Database migration runtime on a production-sized dataset.

---

## Final Opinion

The system has moved from "basic security gaps" to "origin/session isolation and
operational hardening" as the primary risk category. Backend access control is
substantially better than the first audit, but same-origin public HTML plus
browser-stored bearer token is a high-value attack path. Fixing that architecture
boundary will reduce the largest current risk without requiring a broad backend
rewrite.
