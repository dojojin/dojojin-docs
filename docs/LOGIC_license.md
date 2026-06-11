# LOGIC_license — License System & Machine Fingerprint

> Extracted from DECISIONS.md. Canonical source for the Ed25519/JWT
> license system, trial/grace/expired states, machine fingerprint,
> keygen CLI, and EULA integration.
> Parent index: DECISIONS.md
> Last updated: 2026-06-08 · v1.5.0

---

## Historical Note (#36)

**#36 — License key system was DEFERRED until before launch (historical)**
Pre-Phase 8 note: "not a blocker, will add before launch." Phase 8.0 (2026-05-19) shipped the full Ed25519/JWT license system. This decision is now superseded by #100–#108. Retained for traceability only.

---

## License Design (#100–#108)

**#100 — License = signed Ed25519 JWT, offline-first, machine-bound**
Not RSA-2048 (smaller, faster, no padding footguns). Not HMAC (shared secret would let a leaked binary forge licenses). Uses `jose` npm package. Public key embedded in `src/license.js`. Private key stored outside repo at `~/Documents/dojojin-keys/license-private.pem` + 1Password Business. License stored in `system_settings.license_key` (Postgres) — not on disk.

> STUBBORN_FACT: Private key loss = must re-issue ALL customer licenses. Leak = ALL licenses are forgeable. Never commit private key. GOTCHAS #27.
> STUBBORN_FACT: License JWT is stored in `system_settings.license_key` (DB), not a `.license` file. Files are a clear deletion target for trial reset. GOTCHAS #28.

**#101 — Trial = 7 days from FIRST USER LOGIN, not from process boot**
`first_login_at` recorded once on first successful `/api/auth/login` (idempotent via SELECT first). Boot does not reset the clock — attacker can restart service infinite times without resetting trial.

**#102 — License state machine drives the whole gate**

| State | Access |
|---|---|
| `LICENSED` | Full access |
| `TRIAL` | Full access (7 days from first login) |
| `TRIAL_NOT_STARTED` | Open access (no one has logged in yet) |
| `WARN_30D` / `WARN_7D` | Full access + banner |
| `GRACE` | Read-only (writes blocked, GETs allowed) — 7 days after expiry |
| `EXPIRED` | Read-only |
| `TRIAL_EXPIRED` | Read-only |
| `INVALID` | Writes blocked, GETs allowed |

Middleware sits AFTER auth in `app.use('/api', …)`. Skips: `/auth/*`, `/license/*`, `/line/webhook`. 60-second in-memory cache — invalidated immediately on activate/deactivate.
Pre-setup escape: if `LICENSE_PUBLIC_KEY` is still `PLACEHOLDER_PUBLIC_KEY`, middleware bypasses enforcement entirely (dev clones aren't locked out of themselves).

> STUBBORN_FACT: The placeholder public key bypass is intentional for dev clones. Production deployments WILL have a real key. GOTCHAS #27.

**#103 — Camera count enforcement at POST /api/cameras only**
Uses `cameras-config.json` length (not DB table — decision #86) against `payload.max_cameras`. Edits to existing cameras always pass. Cap skipped during `TRIAL` and `TRIAL_NOT_STARTED`.

**#104 — Grace period: 7 days read-only after expiry**
Long enough for customer to notice + contact + get renewal. Short enough to maintain pressure.

**#105 — License period: custom days, sales decides**
`--days N` range 1..3650. Common: 90/180/365/730. Not hard-coded. Hardware-change re-issues are FREE for first 2 per license year (policy, not enforced — tracked in `licenses-issued/ledger.csv`).

**#107 — Keygen tool in `scripts/keygen/` — never ships to customers**
Three-layer protection: `.gitignore` blocks `*-private.pem` / `licenses-issued/`; build pipeline excludes `scripts/keygen/`; `setup-keys.sh` refuses to write into a path inside the repo. `issue-license.js` reads `jose` from `src/node_modules/` via require fallback.

**#108 — Machine fingerprint = strong OS ID first, MAC only as fallback**
Prefers `/etc/machine-id` (Linux) or `ioreg IOPlatformUUID` (macOS). MAC used ONLY when neither resolves. Even in fallback: skip Apple privacy interfaces (`awdl|llw|utun`) and locally-administered MACs (LAA bit signals randomisation).

> STUBBORN_FACT: Machine fingerprint must NOT use MAC address as primary on modern macOS/Linux. awdl0 and Private Wi-Fi Address randomise MAC on WiFi reconnect/sleep. GOTCHAS #26, Decision #108.

---

## EULA Integration (#106)

**#106 — EULA acceptance is a hard blocker on first admin login**
`eulaBootGate()` in `_initDashboard`: if not accepted AND user is admin → fires blocking `#eulaAcceptModal` (no close button, Logout escape only). Viewers bypass — they can't legally bind the deployment.
`eula_accepted_at` + `eula_accepted_by` recorded in `system_settings`. Per-activation EULA checkbox in Activate form reaffirms acceptance on every new key.
Thai EULA: `docs/EULA-th.md` — 12 sections, penalty clause ≥10× license fee, references พ.ร.บ.ลิขสิทธิ์ 2537 + พ.ร.บ.คอมพิวเตอร์ 2550 + PDPA.

---

## Keygen CLI Usage

```bash
# One-time setup (generates Ed25519 keypair)
scripts/keygen/setup-keys.sh

# Issue a license
node scripts/keygen/issue-license.js \
  --customer "Acme Building" \
  --customer-id ACM001 \
  --tier STANDARD \
  --max-cameras 500 \
  --days 365 \
  --out licenses-issued/acme.license

# Dry run (sales preview, no files written)
node scripts/keygen/issue-license.js ... --dry-run
```

Tier defaults: STARTER 100 / STANDARD 500 / PROFESSIONAL 1000 / ENTERPRISE 2000 / DATACENTER 3000.

---

## License State Reference

```
first_login_at = NULL              → TRIAL_NOT_STARTED (open)
first_login_at set, within 7d     → TRIAL (full)
license_key valid, within expiry   → LICENSED / WARN_30D / WARN_7D
license_key expired, within 7d    → GRACE (read-only)
license_key expired, past 7d      → EXPIRED (read-only)
license_key invalid signature      → INVALID (writes blocked)
first_login_at set, trial past 7d  → TRIAL_EXPIRED (read-only)
```

---

## Related files
- `src/license.js` — Ed25519/JWT verify + machine fingerprint + state machine
- `scripts/keygen/setup-keys.sh` — one-time key generation
- `scripts/keygen/issue-license.js` — per-customer license issuance CLI
- `scripts/keygen/README.md` — operator playbook
- `docs/EULA-th.md` — formal Thai EULA (12 sections)
- `db/db_migration_016_license.sql` — license_key + first_login_at + eula fields
- GOTCHAS #26 (MAC fingerprint), #27 (placeholder public key), #28 (store in DB not file)
