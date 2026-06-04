# CODEX_SUGGESTION.MD — Previous Codex Audit Status

> Original audit: 2026-05-24
> First action review: 2026-05-27
> Current verification: 2026-06-03
> Scope: status ledger for the previous Codex concerns. New second-tier audit is
> recorded separately in `CODEX_AUDIT_2ndTier.md`.

---

## Executive Status — 2026-06-03

**Fact:** All original high-confidence concerns from the first Codex audit have
either been fixed, verified as already fixed, or intentionally accepted as
maintenance debt.

**Fact:** The one item that was still pending on 2026-05-27, Docker/EMQX port
exposure, is now closed in the current tree. `docker-compose.yml` binds
PostgreSQL and EMQX dashboard to localhost, exposes MQTT only on localhost plus
the configured camera LAN IP, removes the WebSocket listener exposure, enables
EMQX TCP authn, and reads sensitive passwords from `.env`.

**Opinion:** This file should no longer be used as the current risk register.
Use `CODEX_AUDIT_2ndTier.md` for the new security-first audit findings.

---

## Previous Findings Status

| ID | Previous concern | Current status | Verification notes |
|---|---|---:|---|
| Sec-1 | LINE webhook raw-body verification | Closed | `src/api-server.js` preserves `req.rawBody` via `express.json({ verify })` for `/api/line/webhook`; webhook HMAC uses the preserved raw body. |
| Sec-2 | Docker ports exposed on all interfaces; EMQX auth disabled | Closed | `docker-compose.yml` now uses `127.0.0.1:5432`, `127.0.0.1:1883`, `192.168.10.31:1883`, `127.0.0.1:18083`; EMQX TCP authn is enabled; dashboard password is required from `.env`; WS port is not published. |
| Sec-3 | Production camera credential context in tracked docs | Closed | `ARCHITECTURE.md` was slimmed/redacted in the earlier remediation. Current audit did not print or expose secrets. |
| Sec-4 | Missing browser security headers | Closed for baseline headers | `src/api-server.js` disables `x-powered-by` and sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS on HTTPS, and CSP in Report-Only mode. CSP enforcement remains a new hardening finding in the second-tier audit. |
| Sec-5 | Public `/others` prefix matched too broadly | Closed for prefix bug | `PUBLIC_PATHS` contains exact `/others`; `PUBLIC_PREFIXES` contains strict `/others/`, not a broad `/others` prefix. New same-origin public-script risk is tracked separately in `CODEX_AUDIT_2ndTier.md`. |
| Sec-6 | Unbounded map tile download inputs | Closed | `validateMapBounds()` and `MAP_TILE_LIMITS` enforce lat/lng/zoom validation and a max tile count before starting map download jobs. |
| Sec-7 | Backup download had no audit row | Closed | `/api/backups/:filename` writes a `backup_download` audit entry before streaming the dump. |
| Maint-1 | Tracked stale `.diff` files | Closed | No tracked `.diff`/`.patch` artifacts were found during the 2026-06-03 recheck. |
| Maint-2 | Stale `ROADMAP.md` report/LINE items | Closed | Report History and LINE Phase B/C items are now marked done/struck through. |
| Maint-3 | `service_start.md` Mosquitto drift | Closed for Mosquitto | Mosquitto references from the previous concern are gone. A newer PM2/startup doc drift is tracked in `CODEX_AUDIT_2ndTier.md`. |
| Maint-4 | Root `package.json` license was `ISC` | Closed | Root `package.json` now declares `UNLICENSED`. |
| Maint-5 | Very large `src/api-server.js` | Accepted debt | Still large. Not a direct security bug by itself; route extraction should happen incrementally when touching related areas, not as a broad rewrite. |

---

## Current Important Context

**Fact:** The first audit improved several baseline controls:

- Dashboard/static asset auth gates remain in place.
- `/snapshots/:filename` and `/media/:filename` are auth-gated and filename
  restricted.
- WebSocket connections require a cookie or token and call `auth.getUserFromToken`.
- LINE webhook signature verification has raw body support.
- Branding logo upload rejects SVG and checks image magic bytes before `sharp`.
- Service Management uses PM2 with allowlisted service names/actions and `execFile`
  style command execution.

**Fact:** Some historical text in older generated public docs under
`public/others/vigil-docs/` may still describe previous audit status or older
operations guidance. Those files are public/customer-facing artifacts, not the
current engineering risk register.

**Opinion:** Keep this status file short and factual. Do not keep stale open-risk
writeups here after they have been closed, because that creates audit confusion.

---

## Follow-up Register

Current follow-up items have moved to:

```text
CODEX_AUDIT_2ndTier.md
```

Priority topics from the new audit:

- Same-origin public `/others` pages with third-party scripts while dashboard
  bearer tokens live in browser storage.
- CSP is still Report-Only and permits inline scripts.
- `package-lock.json` files exist locally but are ignored and untracked.
- Many API routes return raw `err.message` / `e.message` to clients.
- PM2 documentation drift remains in `README.md` and `service_start.md`.
