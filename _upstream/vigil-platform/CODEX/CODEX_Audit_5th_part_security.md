# CODEX_Audit_5th_part_security.md — Security Concern Audit

Audit date: 2026-07-21  
Auditor: Codex  
Scope: Centralize deployment + Edge Site deployment, including Edge ↔ Central trust boundary.

## 0. Executive Summary

**Fact**

- Core Central security posture is substantially hardened: `/api` global auth, WebSocket session verification, auditor write-block, admin-only write middleware, CSP enforced, static dashboard assets auth-gated, `/snapshots/*` and `/media/*` auth-gated, Postgres localhost-only, EMQX dashboard localhost-only, and camera credentials are designed for AES-GCM encrypted config.
- Edge architecture intentionally avoids centralizing image bytes over MQTT; it publishes metadata/filenames and serves images only through a bearer-protected snapshot proxy.
- Multi-site RBAC exists at app layer through `getAllowedSites()` + `siteWhere()`, and `mqtt-subscriber` rejects positively confirmed topic-site/camera-site mismatch.
- There are still important security concerns: local `cameras-config.json` permission drift, legacy unauthenticated `/lpr`, anonymous NanoMQ on Edge, EMQX ACL not deny-by-default, public/broad receiver surfaces, and mismatched edge secret instructions.

**Opinion**

ไม่มี Critical ที่ต้องหยุดระบบทันทีจาก static audit รอบนี้ แต่มี **High** หลายรายการที่ควรจัดก่อนขยาย production หลาย site:

1. `cameras-config.json` ต้องกลับเป็น `600` ทุกเครื่อง
2. เลิกใช้ legacy unauthenticated `/lpr`
3. Lock down NanoMQ / edge LAN surface
4. เปลี่ยน EMQX edge ACL เป็น deny-by-default เมื่อพร้อม provision user ครบ
5. เพิ่ม security smoke tests ให้จับ route/public/permission drift อัตโนมัติ

## 1. Evidence Reviewed

- `src/api-server.js`, `src/auth.js`, `src/routes/*.js`
- `src/lpr-receiver.js`, `src/routes/lpr.js`, `src/routes/face-push.js`, `src/lpr-core.js`
- `src/edge/bridge.js`, `src/edge-config-agent.js`, `src/edge/publisher.js`
- `src/site-provision.js`, `src/helpers/publishSiteConfig.js`, `src/helpers/emqxPublish.js`
- `docker-compose.yml`, `ecosystem.config.js`, `ecosystem.edge.config.js`
- `edge/nanomq.conf.template`, `edge/env.template`, `docs/REF_edge-install.md`
- `DECISIONS.md`, `GOTCHAS.md`, `ROADMAP.md`, prior CODEX audit docs
- Filesystem metadata for `.env`, `src/.env`, `cameras-config.json`, `.DS_Store`, and ignored backup/media paths. File contents were not printed.

## 2. Positive Controls

### Centralize

- `app.use('/api', ...)` requires session or valid `X-Internal-Token` for all non-public API routes.
- `WebSocket.Server.verifyClient` rejects unauthenticated upgrades.
- `auth.requireAuth` enforces `must_change_password` server-side.
- `auditor` role is hard-blocked from non-GET writes at server middleware.
- `requireAdminForWrites()` protects sensitive groups: cameras, groups, alerts, line-config, map, categories, settings, report schedules, license, alert logs.
- `/snapshots/*` validates session/internal token, validates path segments, blocks traversal, and supports edge proxy with bearer secret.
- `/media/:filename` is auth-gated and filename allowlisted.
- CSP is enforced; dashboard no longer depends on jsdelivr for core libraries.
- Docker binds Postgres to `127.0.0.1:5432`; EMQX dashboard to `127.0.0.1:18083`; EMQX TCP/WS authn is enabled.
- Service management uses PM2 allowlists and `execFile`, not shell interpolation.
- Branding upload uses multer memory storage and magic-byte/image processing controls.

### Edge Site

- Edge publishes metadata only; image bytes stay on edge disk.
- `publishSiteConfig()` sends per-site camera config to retained MQTT topic and encrypts camera credentials before publish.
- `edge-bridge` filters downlink-only config/scan topics to prevent relay loops.
- `mqtt-subscriber` cross-checks `projects/<site>/...` topic site against camera's DB site and rejects confirmed mismatch.
- `lpr-receiver` snapshot proxy requires `Authorization: Bearer SNAPSHOT_PROXY_SECRET`.
- Edge snapshot retention has strong path guards and only prunes `snapshots/events/YYYY-MM-DD`.

## 3. Findings Summary

| ID | Severity | Area | Central | Edge | Finding |
|---|---:|---|---:|---:|---|
| SEC5-HIGH-001 | High | Secrets at rest | Yes | Yes | `cameras-config.json` permission drift: current file is `644`, should be `600` |
| SEC5-HIGH-002 | High | Public ingest | Yes | Yes | Legacy unauthenticated `POST /lpr` remains active |
| SEC5-HIGH-003 | High | Edge LAN broker | No | Yes | NanoMQ template binds `0.0.0.0` with anonymous allow and public admin default |
| SEC5-HIGH-004 | High-Med | MQTT tenant isolation | Yes | Yes | EMQX edge ACL is allow-rule only; not deny-by-default yet |
| SEC5-MED-001 | Medium | Receiver exposure | Yes | Yes | `lpr-receiver` binds `0.0.0.0`; token paths/body limits need WAF/rate guard |
| SEC5-MED-002 | Medium | URL capability tokens | Yes | Yes | LPR/face push tokens live in URL path; rotation/log policy needed |
| SEC5-MED-003 | Medium | Edge secrets docs | No | Yes | `edge/env.template` says generate `CAMERA_SECRET_KEY`, conflicting with required Central key copy |
| SEC5-MED-004 | Medium | Admin scan trust | Yes | Yes | Edge NVR scan sends credentials in MQTT payload; keep non-retained + scoped + audited |
| SEC5-MED-005 | Medium | Internal bypass | Yes | No | `INTERNAL_API_SECRET` fallback should fail-fast or alarm in production |
| SEC5-MED-006 | Medium | Multi-site defense depth | Yes | Yes | App-layer `siteWhere()` is strong but route-forgetful; RLS/route smoke tests still needed |
| SEC5-LOW-001 | Low | Hygiene | Yes | Yes | `.DS_Store` exists in workspace; ignored but should be cleaned |
| SEC5-LOW-002 | Low-Med | Public metadata | Yes | No | `/tiles/` remains public by design; customer policy decision |

## 4. Detailed Findings

### SEC5-HIGH-001 — `cameras-config.json` permission drift exposes encrypted/plain credential material to local users

**Fact**

- Filesystem metadata shows:
  - `.env` = `-rw-------`
  - `src/.env` = `-rw-------`
  - `cameras-config.json` = `-rw-r--r--`
- GOTCHAS #69 / decision #191 require `chmod 600 cameras-config.json`.
- `cameras-config.json` is gitignored and contains camera connection configuration. Some values may be encrypted (`enc:v1:`), but the file remains sensitive.

**Risk**

Local non-owner users on the host can read camera topology and possibly encrypted credential blobs/tokens. If plaintext fallback ever appears, impact becomes direct credential disclosure.

**Recommendation**

- Run `chmod 600 cameras-config.json` on Central and every Edge node.
- Add startup/health warning when permission is broader than `600`.
- Add deploy checklist item: `stat -c %a cameras-config.json` on Linux / `stat -f %Lp cameras-config.json` on macOS.
- Keep `CAMERA_SECRET_KEY` in `src/.env` at `600`.

### SEC5-HIGH-002 — Legacy unauthenticated `POST /lpr` remains active

**Fact**

- `src/routes/lpr.js` defines both:
  - `POST /lpr/:token` authenticated by per-camera token
  - `POST /lpr` legacy unauthenticated route
- `src/lpr-core.js` logs legacy unauthenticated hits but still ingests if it can resolve camera from payload.
- `src/api-server.js` marks exact `/lpr` public.

**Risk**

Anyone who can reach the receiver path can send multipart ANPR-like payloads. Even if camera resolution fails for many payloads, this is a public parse/store/forward surface and can be used for spoofing attempts or resource pressure.

**Recommendation**

- Set a deprecation date and migrate every camera to `/lpr/:token`.
- After migration, remove or block `POST /lpr`.
- Before removal, add Cloudflare WAF/rate limit on `^/lpr$` and alert on any legacy hit.
- Consider returning 410/403 for legacy path except explicitly allowlisted camera source IPs during migration.

### SEC5-HIGH-003 — Edge NanoMQ allows anonymous LAN access and broad bind

**Fact**

- `edge/nanomq.conf.template` binds TCP and WS to `0.0.0.0`.
- Template has:
  - `allow_anonymous = true`
  - `no_match = allow`
  - HTTP admin `username = admin`, `password = public`
- `docs/REF_edge-install.md` says anonymous local broker is acceptable for local-only POC.

**Risk**

At real sites, camera LAN is not automatically trusted. Any host on that LAN could publish fake events, config-like messages, or high-volume payloads to NanoMQ. The HTTP admin default is also a known weak credential if exposed.

**Recommendation**

- If Bosch cameras must publish to NanoMQ over LAN, restrict by host firewall to camera VLAN/source IPs.
- Disable WS listener unless actually used.
- Bind NanoMQ HTTP management to `127.0.0.1` or disable it; change default password.
- Add NanoMQ auth/ACL for production edges.
- Lower `max_packet_size` because image bytes are not supposed to cross MQTT.

### SEC5-HIGH-004 — EMQX edge ACL is not deny-by-default

**Fact**

- `src/site-provision.js` creates an edge user and adds an ACL allow rule for `projects/<code>/#`.
- The same file explicitly notes it does not flip EMQX `no_match` to deny, so default ACL still allows authenticated clients.
- `mqtt-subscriber.js` now rejects positively confirmed camera/site mismatch, which is a good application-layer compensating control.

**Risk**

If an edge credential leaks or a client is misconfigured, broker-level isolation may not stop publishes outside that site's namespace. Application code blocks confirmed camera/site mismatches, but broker-level deny-by-default is still stronger and protects non-camera/control topics too.

**Recommendation**

- Inventory all existing EMQX users and required topic rights.
- Move to deny-by-default authz once explicit rules exist for camera users, subscriber, edge users, and config publishers.
- Add a smoke test: `edge-a` cannot publish/subscribe `projects/edge-b/#`.
- Keep app-layer mismatch reject as defense in depth.

### SEC5-MED-001 — `lpr-receiver` broad bind and raw-body surfaces need rate controls

**Fact**

- `src/lpr-receiver.js` defaults `LPR_BIND_HOST` to `0.0.0.0`.
- It exposes `/lpr`, `/lpr/:token`, `/face-push/:token`, `/healthz`, and bearer-protected `/snapshots`.
- LPR/face routes accept raw body up to `20mb`.

**Risk**

This is intentionally public for camera push, but it is also a large unauthenticated parser surface. Unknown tokens are dropped after body parsing. Attackers can send many large bodies and consume CPU/memory.

**Recommendation**

- Prefer Cloudflare route/WAF in front; do not expose port 3003 directly to the internet.
- Add IP/source rate limiting at Cloudflare and optionally in Express.
- Reject unknown token earlier where path token exists, before expensive parse.
- Tighten body limit to measured camera payload plus margin.
- Make `/healthz` either localhost-only or return minimal no-version metadata.

### SEC5-MED-002 — URL path tokens need rotation/log handling

**Fact**

- `face_push_token` and `lpr_push_token` are generated by admin endpoints and embedded in URL paths.
- They are intentionally capability secrets for cameras.

**Risk**

Path tokens can be captured in Cloudflare logs, reverse proxy logs, camera config screenshots, browser history if tested manually, or support tickets. They are long entropy, but operational leakage is plausible.

**Recommendation**

- Document token as one-time secret; never paste into public chat/tickets.
- Add rotate workflow and last-rotated timestamp.
- Consider future header-based token for integrations that support custom headers.
- Redact token-like URL paths in logs where possible.

### SEC5-MED-003 — `edge/env.template` gives wrong instruction for `CAMERA_SECRET_KEY`

**Fact**

- `docs/REF_edge-install.md` says `CAMERA_SECRET_KEY` must be identical to Central.
- `edge/env.template` says to generate new secrets per site and includes `CAMERA_SECRET_KEY=<openssl rand -hex 32>`.
- GOTCHAS #98 says mismatched key causes decrypt failures.

**Risk**

An operator following the template can break edge camera credential decryption. This is primarily availability, but it can also lead to unsafe workarounds such as reintroducing plaintext credentials.

**Recommendation**

- Update template to say: copy exact `CAMERA_SECRET_KEY` from Central.
- Keep per-site generation only for `BRIDGE_PASSWORD`, `SESSION_SECRET`, `INTERNAL_API_SECRET`, and tunnel-specific secrets.
- Add edge startup check that decrypt failure reports likely key mismatch.

### SEC5-MED-004 — Edge NVR scan sends credentials in MQTT payload

**Fact**

- `POST /api/cameras/scan-nvr` can publish `{ ip_address, username, password }` to `projects/<site>/_config/scan-nvr`.
- `emqxPublish()` uses EMQX HTTP API to publish with `retain=false` by default.
- `edge-bridge` relays scan requests down to local NanoMQ non-retained.

**Risk**

This is admin-only and non-retained, but credentials are still in transit through EMQX/NanoMQ payloads and can be visible to broker admins or compromised broker clients if ACLs are loose.

**Recommendation**

- Keep `retain=false` non-negotiable.
- Ensure scan topic is only subscribable by the intended edge user.
- Add audit log for scan request including site and IP, not password.
- Avoid logging request body in any process.
- Consider sending a short-lived encrypted scan payload keyed to `CAMERA_SECRET_KEY`.

### SEC5-MED-005 — `INTERNAL_API_SECRET` fallback should not be silent in production

**Fact**

- `api-server.js` falls back to a random internal token when `INTERNAL_API_SECRET` is absent/short.
- `report-renderer` and workers rely on `X-Internal-Token` for internal calls.

**Risk**

Fallback is safe from accidental bypass, but production misconfiguration can break reports/workers later instead of failing at boot.

**Recommendation**

- Fail fast when `NODE_ENV=production` and `INTERNAL_API_SECRET` is missing or too short.
- At minimum, expose a red Health warning.
- Add smoke test that report-worker and api-server share the same token.

### SEC5-MED-006 — Multi-site RBAC is app-layer and needs regression tests

**Fact**

- `getAllowedSites()` and `siteWhere()` are used broadly across events, faces, LPR, appearances, reports, stats, and ops.
- `siteWhere([])` returns `AND FALSE`; `null` means all sites for admin/auditor.
- Decision #216 acknowledges route authors must remember to call `siteWhere()`.

**Risk**

The current pattern works, but future routes can forget site filtering and fail open. This matters as soon as customers/sites share one Central.

**Recommendation**

- Add route smoke tests for a site-scoped viewer.
- Add code-review checklist: any endpoint returning event/camera/person/plate data must call `siteWhere()` or explain why not.
- Consider PostgreSQL RLS as Tier-2 defense in depth later, not as immediate blocker.

### SEC5-LOW-001 — `.DS_Store` hygiene drift

**Fact**

- `.DS_Store` files currently exist in repo workspace, including under `snapshots/` and `public/`.
- `.gitignore` ignores them; static mounts use `dotfiles: 'deny'`.

**Risk**

Low tracked-code risk, but it contradicts prior cleanup expectations and can leak filesystem metadata if copied outside the guarded app.

**Recommendation**

- Remove local `.DS_Store` files.
- Add periodic hygiene check in audit/deploy script.

### SEC5-LOW-002 — Public tiles are accepted risk but customer-dependent

**Fact**

- `/tiles/` is public by design.
- Camera overlays and API data remain auth-gated.

**Risk**

Some customers may treat map/floor/site tile structure as sensitive even without camera markers.

**Recommendation**

- Classify tile sensitivity per customer.
- If floorplans are sensitive, auth-gate tiles or use non-sensitive base tiles only.

## 5. Security Actions Recommended

**Immediate**

1. `chmod 600 cameras-config.json` on Central and Edge.
2. Update `edge/env.template` for `CAMERA_SECRET_KEY`.
3. Add warning if legacy `/lpr` is hit; inventory remaining cameras using it.
4. Lock down NanoMQ HTTP/WS and host firewall on Edge.

**Before Wider Multi-Site Rollout**

1. Remove or block legacy `/lpr`.
2. Make EMQX authz deny-by-default after user ACL inventory.
3. Add site-scoped route smoke tests.
4. Add push receiver rate limits/WAF rules.
5. Add Edge credential/topic scan audit controls.

**Later Defense In Depth**

1. RLS for multi-site data.
2. Header-based camera push tokens where vendors support it.
3. Short-lived/encrypted admin scan payloads.
4. Automated secret/file-permission audit in Health.

## 6. Validation Notes

This pass was static/source + filesystem metadata audit. I did not run authenticated penetration tests, network scans, EMQX auth smoke tests, dependency vulnerability scans, or live exploit probes.

## 7. Verification Update — 2026-07-22 (Claude, live code + live system re-check)

Re-checked every finding against current code (`grep`/`Read`) and live systems (SSH into hdy-edge + vss-edge; central filesystem). Cross-referenced against `CODEX_Audit_6th_live_pentest_summary.md` (live pentest run 2026-07-21, after this doc was written).

| ID | Status as of 2026-07-22 |
|---|---|
| HIGH-001 | **Central: fixed** (`cameras-config.json` is `600`, `chmodSync` self-heal in `api-server.js:836`). **Edge: was still `664`** on both hdy-edge/vss-edge (`edge-config-agent.js` wrote config with no chmod) — **fixed this pass**, see Phase 1 below. |
| HIGH-002 | **Resolved (Phase 4c, 2026-07-22).** `POST /lpr` now returns `410 Gone` immediately, no body parsing, before any processing. Closed on log evidence: grepped Central + both live edges' full log history — **zero hits ever recorded** on this route from any camera. Kept as a logged stub rather than a hard 404/removal so a stray future hit is diagnosable. |
| HIGH-003 | Still open on both edges (SSH-verified: `allow_anonymous=true`, `0.0.0.0` bind, default `admin/public` HTTP creds). **Elevated priority**: this broker now also carries the `_config/detect-model` and `_config/delete-media` command channels shipped in the optimization-audit closure (2026-07-21/22) — anonymous access is no longer just an ingest-spoofing risk, it's a path to trigger a destructive command. |
| HIGH-004 | **Prep in progress (Phase 4a, 2026-07-22), `no_match` still `allow` — not yet flipped.** Inventory found 8 of 11 EMQX users had zero explicit ACL rule (`dashboard-subscriber` + 7 `cam-*` Bosch camera accounts), relying entirely on `no_match=allow` — flipping to deny-by-default without fixing this first would have dropped the entire Bosch fleet + the dashboard's live event subscription instantly. Added explicit rules for `dashboard-subscriber` (subscribe: the 5 wildcard patterns `mqtt-subscriber.js` actually uses, incl. `projects/+/#` which already covers `_config/detect-model`/`_config/delete-media`/`_config/scan-nvr` and their `..._result` topics) and 6 of the 7 camera accounts (publish `{camera_id}/onvif-ej/#`, derived from the same `cam-<id>` naming rule `routes/cameras.js` uses to provision them). **`cam-b3100i-2` has no matching `camera_id` in the `cameras` table — likely orphaned from a renamed/removed camera — left untouched, flagged for owner decision.** Also found 3 orphaned ACL rules (`edge-zztest`/`zztest2`/`zztest3` — users no longer exist in authn) — not removed this pass. `no_match` itself has NOT been flipped — that is a separate, explicitly-gated future step once the remaining gaps (zztest cleanup, `cam-b3100i-2` disposition) are resolved. |
| MED-001 | Still open (`lpr-receiver` binds `0.0.0.0`, 20mb raw body limit) — confirmed again by 6th-audit `LIVE-MED-001`. |
| MED-002 | Still open — inherent design gap, not scheduled. |
| MED-003 | Confirmed still wrong (`edge/env.template` told operators to generate a new `CAMERA_SECRET_KEY`) — **fixed this pass**. |
| MED-004 | Still open, and scope has grown: the new `detect-model` channel sends `username`/`password` in the MQTT payload via the same pattern as `scan-nvr`. |
| MED-005 | **Resolved (Phase 3, 2026-07-22).** `NODE_ENV=production` added to the shared PM2 `env` block in `ecosystem.config.js`; `api-server.js`'s `INTERNAL_API_TOKEN` fallback now `process.exit(1)`s when the secret is missing/short **and** `NODE_ENV === 'production'` (dev/first-boot without `NODE_ENV` keeps the old ephemeral-fallback convenience). Verified all 4 branches (prod+missing, prod+set, dev+missing, dev+set) in isolation before touching the real process; deployed via `pm2 start ecosystem.config.js && pm2 save` (plain `pm2 kill && resurrect` would not have picked up the new env). Live boot confirmed clean — no fail-fast fired (prod secret is valid, 64 chars), `report-worker` (which already hard-failed on this secret unconditionally) unaffected. |
| MED-006 | Still open — `test/` has no file touching `siteWhere`/multi-site/RBAC. |
| LOW-001 | Confirmed 6 `.DS_Store` files present (already gitignored, never tracked) — **removed this pass**. |
| LOW-002 | Still open, as-designed/accepted. |

See `CODEX_Audit_6th_live_pentest_summary.md` for the live-pentest-only findings (LIVE-HIGH-001/002, LIVE-MED-003/004, LIVE-LOW-001, LIVE-PASS-001) that supplement this document.
