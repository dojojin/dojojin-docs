# CODEX_AUDIT_2ndTier.md — Security-first Audit

> Audit date: 2026-06-03
> Reviewer: Codex
> Repository: `vigil-platform`
> Scope: static source review, selected local runtime probes, documentation
> consistency review, security-first risk assessment. No secrets were printed.
>
> Recheck date: 2026-06-07
> Recheck result: most second-tier findings are now closed or intentionally
> accepted/deferred. The main remaining work is residual browser third-party
> script exposure, full API error-response cleanup, and continued incremental
> `api-server.js` route extraction.

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

## Recheck Update — 2026-06-07

**Fact:** `/others/*` is no longer public in the current runtime behavior. Local
unauthenticated probes to `/others/vendor-comparison.html` and
`/others/vigil-docs-v2/index.html` returned `302` to `/disclaimer.html`, not
`200 OK`. `PUBLIC_PREFIXES` no longer includes `/others/`; `/others` access
falls through the static auth middleware unless explicitly allowlisted.

**Fact:** The high-value public-page CDN path from the original finding is
closed: the EmailJS, Materialize, and Cytoscape `/others` HTML files called out
in this audit are gone. Remaining `/others` pages use local scripts/assets and
are auth-gated by default.

**Fact:** CSP is now enforced via `Content-Security-Policy`, and the dashboard
scan found no inline event handlers or inline `<script>` blocks. The policy
still allows `style-src 'unsafe-inline'` and allows `cdn.jsdelivr.net` for
dashboard/report libraries.

**Fact:** `src/package-lock.json` is tracked, `.DS_Store` files are gone, static
mounts use `dotfiles: 'deny'`, PM2 docs were updated, and
`GET /api/line-config` is now `admin`/`auditor` only.

**Fact:** `src/helpers/routeError.js` exists and is widely wired; no raw
`res.status(500).json({ error: err.message })` / `e.message` pattern remains in
the searched route files. Some `400` validation responses still return
`e.message` and should be reviewed route-by-route.

**Opinion:** The original P0/P1 `/others` issue can be treated as closed for
the public unauthenticated path. The remaining browser risk should be tracked as
a separate hardening item: self-host or pin third-party dashboard libraries
currently loaded from `cdn.jsdelivr.net` while the dashboard still uses browser
storage bearer tokens.

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
| SEC-2T-001 | High | Browser/session | Closed primary / residual hardening | `/others/*` is auth-gated and called-out CDN files were removed. Remaining work: self-host/pin dashboard CDN libraries because bearer tokens remain in browser storage. |
| SEC-2T-002 | Medium | Browser hardening | Closed baseline / residual hardening | CSP is enforced and inline dashboard scripts/handlers are removed. Remaining work: reduce `style-src 'unsafe-inline'` and third-party dashboard library allowlists. |
| SEC-2T-003 | Medium | Supply chain | Closed for runtime | `src/package-lock.json` is tracked. Root lockfile remains ignored because root package has no runtime dependencies. |
| SEC-2T-004 | Medium | API error handling | Partial | 500-path raw error leaks are fixed through `routeError()`. Remaining work: review user-facing `400` validation messages route-by-route. |
| SEC-2T-005 | Low-Medium | Access control / privacy | Closed | `GET /api/line-config` now requires `admin` or `auditor`. |
| SEC-2T-006 | Low | Credential hardening | Partial / accepted risk | Health warning for plaintext camera credentials exists. Strict write-blocking when `CAMERA_SECRET_KEY` is missing is deferred. |
| SEC-2T-007 | Low | Public static hygiene | Closed | `.DS_Store` files were removed, `.gitignore` covers them, and static mounts deny dotfiles. |
| SEC-2T-008 | Low | Public surface | Deferred / accepted by design | `/tiles/` remains public by decision; map overlays and camera data remain API-gated. |
| OPS-2T-001 | Medium | Operations docs | Closed | `README.md` and `service_start.md` now point operators to PM2 / `scripts/services.sh`; `start:all` only emits a warning. |
| DB-2T-001 | Medium | Migration safety | Guard / deferred to future schema work | Documented as a migration review guard; apply on future large-table index migrations. |
| MAINT-2T-001 | Medium | Maintainability | Accepted debt / in progress | Large `api-server.js` remains, but `routeError()` exists and route extraction has started with `src/routes/categories.js`. |

---

## Detailed Findings

Note: the `Original evidence` blocks below preserve the 2026-06-03 audit trail.
The `Recheck 2026-06-07` blocks and the Findings Summary table are the current
status.

### SEC-2T-001 — Public same-origin `/others` pages can become token-exfiltration surface

Severity: **High**

Status: **Closed primary / residual hardening**

Recheck 2026-06-07:

- Current unauthenticated runtime probes to `/others/vendor-comparison.html` and
  `/others/vigil-docs-v2/index.html` returned `302` to `/disclaimer.html`.
- `PUBLIC_PREFIXES` no longer includes `/others/`; `/others` is default-deny
  unless an explicit allowlist is added.
- The previously cited public CDN pages (`index.html`, `vss_v1.html`,
  `boxbox-th.html`, `boxbox-en.html`) are no longer present.
- Residual hardening remains because the authenticated dashboard still loads
  libraries from `cdn.jsdelivr.net` while bearer tokens remain in browser
  storage.

Original evidence (2026-06-03):

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

Suggested priority: **Closed for `/others`; P2 residual dashboard CDN hardening**.

---

### SEC-2T-002 — CSP enforcement and residual browser hardening

Severity: **Medium**

Status: **Closed baseline / residual hardening**

Recheck 2026-06-07:

- `src/api-server.js` now sends enforced `Content-Security-Policy`, not
  `Content-Security-Policy-Report-Only`.
- Search found no inline `onclick=`/`onload=`/`onerror=`/inline `<script>` in
  `dashboard/index.html`, `dashboard/login.html`, or `public/others`.
- Residual policy debt: `style-src 'unsafe-inline'` remains and dashboard/report
  scripts still allow `cdn.jsdelivr.net`.

Original evidence (2026-06-03):

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

Suggested priority: **P2 residual CSP tightening after library self-hosting**.

---

### SEC-2T-003 — Dependency installs are not reproducible from Git

Severity: **Medium**

Status: **Closed for runtime dependencies**

Recheck 2026-06-07:

- `git ls-files` lists `src/package-lock.json`.
- `.gitignore` explicitly unignores `!src/package-lock.json`.
- Root `package-lock.json` remains ignored; root `package.json` currently has no
  runtime dependencies.

Original evidence (2026-06-03):

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

Suggested priority: **Closed; keep using `npm ci` for runtime deploys**.

---

### SEC-2T-004 — API routes return raw error messages to clients

Severity: **Medium**

Status: **Partial**

Recheck 2026-06-07:

- `src/helpers/routeError.js` exists and returns a generic
  `{ error: 'Internal server error', code: 'ERR_INTERNAL' }`.
- No searched `500` route pattern still returns `err.message` / `e.message` to
  clients.
- Remaining review: several `400` validation responses still return
  `e.message`; some are intentionally user-actionable, but sensitive routes
  should be reviewed individually.

Original evidence (2026-06-03):

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

Suggested priority: **P2 cleanup for remaining validation messages**.

---

### SEC-2T-005 — LINE config recipient roster is readable by any authenticated role

Severity: **Low-Medium**

Status: **Closed**

Recheck 2026-06-07:

- `GET /api/line-config` now uses `auth.requireAdminOrAuditor`.
- Non-admin viewer access to the full recipient roster is no longer allowed by
  this route.

Original evidence (2026-06-03):

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

Suggested priority: **Closed**.

---

### SEC-2T-006 — Camera credential encryption still has plaintext fallback

Severity: **Low**

Status: **Partial / accepted risk**

Recheck 2026-06-07:

- `/api/health/details` now reports `security.plaintext_creds` by reading the
  raw camera config and warning when stored credentials are not `enc:v1:`.
- Strictly blocking new plaintext writes when `CAMERA_SECRET_KEY` is missing is
  still deferred; `encryptCred()` intentionally tolerates plaintext fallback for
  migration/rollback compatibility.

Original evidence (2026-06-03):

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

Suggested priority: **P3 deferred strict-write mode**.

---

### SEC-2T-007 — Public-tree `.DS_Store` files exist but were not served in local probe

Severity: **Low**

Status: **Closed**

Recheck 2026-06-07:

- `find . -name .DS_Store` returned no files.
- `.gitignore` includes `.DS_Store` and `.DS_Store?`.
- `express.static` mounts for branding, `/others`, and dashboard assets set
  `dotfiles: 'deny'`.

Original evidence (2026-06-03):

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

Suggested priority: **Closed**.

---

### SEC-2T-008 — Public `/tiles/` cache may reveal map coverage

Severity: **Low**

Status: **Deferred / accepted by design**

Recheck 2026-06-07:

- `/tiles/` remains in `PUBLIC_PREFIXES`.
- ROADMAP marks this as accepted/public by design: cached tile PNGs are public,
  while camera overlays and camera data remain behind authenticated APIs.

Original evidence (2026-06-03):

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

Suggested priority: **Deferred unless a customer classifies tile coverage as sensitive**.

---

### OPS-2T-001 — PM2/startup documentation drift

Severity: **Medium**

Status: **Closed**

Recheck 2026-06-07:

- `README.md` and `service_start.md` now document PM2 /
  `./scripts/services.sh` as the normal service lifecycle path.
- Remaining `src/package.json` `start:all` / `start:full` scripts only print a
  PM2 warning and do not claim to start the stack.

Original evidence (2026-06-03):

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

Suggested priority: **Closed**.

---

### DB-2T-001 — Future large-table indexes can still lock production if not handled carefully

Severity: **Medium**

Status: **Guard / deferred to future schema work**

Recheck 2026-06-07:

- `GOTCHAS.md` documents the production-lock rule for large-table
  `CREATE INDEX` operations.
- This remains a review guard for future migrations, not a current open code
  fix.

Original evidence (2026-06-03):

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

Suggested priority: **Apply during future schema/migration reviews**.

---

### MAINT-2T-001 — `src/api-server.js` remains a large security-sensitive file

Severity: **Medium**

Status: **Accepted debt / in progress**

Recheck 2026-06-07:

- `src/api-server.js` remains large and security-sensitive.
- Mitigation has started: `src/helpers/routeError.js` exists, and
  `src/routes/categories.js` is the first route module extraction.
- Continue opportunistic route extraction only when touching each subsystem.

Original evidence (2026-06-03):

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

Updated 2026-06-07:

1. **P2 — Self-host or pin dashboard third-party libraries.** The original
   public `/others` issue is closed, but authenticated dashboard pages still
   load JavaScript from `cdn.jsdelivr.net` while bearer tokens remain in browser
   storage.
2. **P2 — Finish API error-response cleanup.** `routeError()` fixed the raw 500
   path; review remaining `400` validation messages in sensitive routes.
3. **P2/P3 — Tighten residual CSP.** After self-hosting libraries, remove
   dashboard `cdn.jsdelivr.net` script/style allowances where possible and reduce
   `style-src 'unsafe-inline'`.
4. **P3 — Decide strict camera-credential write mode.** Health warnings exist;
   strict `CAMERA_SECRET_KEY` write enforcement remains deferred.
5. **P3 — Continue opportunistic route extraction.** Keep `api-server.js`
   shrinking through route modules when touching subsystems.
6. **Future schema work — keep DB index guard active.** Any large-table index
   migration must explicitly consider the concurrent/manual path.

---

## Validation Notes

Validated in original 2026-06-03 audit:

- Previous audit findings were rechecked against current source.
- Docker/EMQX current configuration was inspected.
- Local `/others/` route is public and returns content.
- Local `/others/.DS_Store` route returned `404`, so the discovered `.DS_Store`
  was not served in that probe.
- Local `/api/auth/me` without credentials returned `401`.
- `package-lock.json` and `src/package-lock.json` are ignored/untracked.
- PM2/startup documentation drift was confirmed by source search.
- Upload magic-byte validation exists for branding logo upload.

Revalidated on 2026-06-07:

- Local unauthenticated `/others/vendor-comparison.html` returned `302` to
  `/disclaimer.html`.
- Local unauthenticated `/others/vigil-docs-v2/index.html` returned `302` to
  `/disclaimer.html`.
- Local unauthenticated `/api/auth/me` returned `401`.
- `src/package-lock.json` is tracked.
- No `.DS_Store` files were found by `find . -name .DS_Store`.
- `node --check src/api-server.js`
- `node --check src/helpers/routeError.js`
- `node --check src/routes/categories.js`
- `node --test test/*.test.js` passed 43/43 tests.

Not validated:

- Authenticated role-by-role API behavior in browser.
- Actual CDN compromise/XSS exploit.
- Registry dependency vulnerability state.
- Production network/firewall exposure beyond inspected compose config.
- Database migration runtime on a production-sized dataset.

---

## Final Opinion

As of the 2026-06-07 recheck, the original public `/others` same-origin path is
closed in practice: unauthenticated public pages no longer execute under the
dashboard origin. The highest remaining browser risk is narrower: authenticated
dashboard pages still depend on third-party CDN JavaScript while bearer tokens
exist in browser storage. Backend hardening has improved materially, but API
error cleanup and route extraction should continue incrementally.
