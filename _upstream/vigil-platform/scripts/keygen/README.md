# DojoJin License Keygen — Operator Playbook

> ⚠️ **INTERNAL USE ONLY.** Everything in this folder, plus the matching
> private key (stored outside the repo), is the engine that forges valid
> licenses. Never deploy this folder to a customer server. Never share
> the private key. If it leaks, every license ever issued becomes
> forgeable — rotate immediately.

## One-time setup

Run this **once** on your issuing machine (laptop or secure VM):

```bash
bash scripts/keygen/setup-keys.sh
```

The script:

1. Generates an Ed25519 keypair (private + public) outside the repo at
   `~/Documents/dojojin-keys/` by default.
2. Prints the public-key PEM block.
3. **You then paste that PEM block into `src/license.js`**, replacing the
   `LICENSE_PUBLIC_KEY` placeholder value.
4. **Back up the private key into 1Password Business** (Secure Note
   named e.g. "DojoJin License Private Key"). Without a backup, losing
   the private key forces you to re-issue every active customer.

Once done, commit + tag the public-key change:

```bash
git add src/license.js
git commit -m "chore(license): bind to production Ed25519 public key"
git tag license-pubkey-v1
```

## Issue a license (per customer)

When a customer pays:

```bash
node scripts/keygen/issue-license.js \
  --machine     A3B2C1-D5E6F7-G8H9I0-J1K2L3 \
  --customer    "Acme Building" \
  --customer-id ACM001 \
  --tier        STANDARD \
  --max-cameras 500 \
  --days        365
```

The script prints the JWT string to stdout and writes:

- `licenses-issued/<YYYY-MM-DD>_<customer-slug>.license` — a backup
  copy of the key (chmod 600).
- An appended row to `licenses-issued/ledger.csv` — who got what,
  when, expiring when.

Email the JWT string (or attach the `.license` file) to the customer.
They paste it into **Settings → 🔐 License → Activate** in their
dashboard.

### Required flags

| Flag | Description |
|---|---|
| `--machine` | The 24-character Machine ID the customer copied from their dashboard (`AAAAAA-BBBBBB-CCCCCC-DDDDDD`). |
| `--customer` | Display name, used in their dashboard's banner. |
| `--days` | License validity in days. Sales picks (suggested: 90/180/365/730). |

### Optional flags

| Flag | Default | Notes |
|---|---|---|
| `--customer-id` | derived from `--customer` | Short code for the ledger. |
| `--tier` | `STANDARD` | STARTER / STANDARD / PROFESSIONAL / ENTERPRISE / DATACENTER |
| `--max-cameras` | tier default | Override the tier cap (100/500/1000/2000/3000 by default). |
| `--features` | all | Comma-separated whitelist. Most cases keep the default. |
| `--private-key` | `~/Documents/dojojin-keys/license-private.pem` | Custom path if you keep the key elsewhere. |
| `--out` | `licenses-issued/<date>_<slug>.license` | Override the output file. |
| `--dry-run` | — | Print what would be issued without writing files (handy for previewing). |

## Renewal / extension

A renewal is just another `issue-license.js` call with the same
`--machine` + same customer fields + a fresh `--days`. The customer's
dashboard treats it as a normal activation (they paste the new key,
the old one is replaced).

## Re-issue after hardware change (per policy: 2× per year free)

If the customer's hardware changed (new Machine ID), they re-open
Settings → 🔐 License, copy the new Machine ID, send it to us. We run
the same command with the new `--machine` value. Append a note to the
ledger explaining "re-issue, hardware change, machine_id before/after"
so we can track against the policy.

## Files in this folder

| File | Purpose |
|---|---|
| `setup-keys.sh` | One-time keypair generator (bash, macOS/Linux/Git Bash). |
| `issue-license.js` | The signing CLI (this README is its operator's manual). |
| `package.json` | Lets the folder install `jose` locally when used outside the main repo. |
| `README.md` | You are here. |

## Portable mode — using the keygen on a different machine (e.g. Windows)

The whole `scripts/keygen/` folder is self-contained — copy it anywhere
(USB stick, Windows laptop, sales-ops VM) and it works. The CLI auto-
detects whether it's running inside the main dashboard repo or
standalone, and adjusts default paths accordingly (output + ledger go
NEXT TO the script when standalone).

### Setup on a fresh machine (one-time)

1. Install **Node.js 18+** from https://nodejs.org/
2. Install **OpenSSL** (macOS/Linux: already there; Windows: bundled
   with Git for Windows, or download from https://slproweb.com/)
3. Copy the `scripts/keygen/` folder anywhere convenient (e.g.
   `~/Desktop/dojojin-keygen/` or `C:\dojojin-keygen\`)
4. Open a terminal in that folder and install the dependency:
   ```
   npm install
   ```
   (This is what the standalone `package.json` is for — it installs
   the `jose` library locally in `node_modules/`.)

### Generate the keypair (one-time per company)

If you've never run `setup-keys.sh` before:

  **macOS / Linux / Git Bash:**
  ```bash
  bash setup-keys.sh
  ```

  **Windows (PowerShell or cmd.exe, manual openssl):**
  ```powershell
  $keysDir = "$env:USERPROFILE\Documents\dojojin-keys"
  mkdir $keysDir -Force | Out-Null
  openssl genpkey -algorithm ed25519 -out "$keysDir\license-private.pem"
  openssl pkey -in "$keysDir\license-private.pem" -pubout -out "$keysDir\license-public.pem"
  type "$keysDir\license-public.pem"     # ← copy this block into src/license.js
  ```

  Either way: paste the resulting **public** key block into
  `LICENSE_PUBLIC_KEY` in `src/license.js` of the main dashboard repo,
  back up the **private** key into 1Password, and you're done with
  setup.

### Issue a license (Windows example)

```powershell
node issue-license.js `
  --machine     A3B2C1-D5E6F7-G8H9I0-J1K2L3 `
  --customer    "Acme Building" `
  --tier        STANDARD `
  --max-cameras 500 `
  --days        365
```

(Backticks ` are PowerShell line-continuation; on cmd.exe use `^`
instead, on bash use `\`.)

By default the private key is read from
`%USERPROFILE%\Documents\dojojin-keys\license-private.pem` on Windows
or `~/Documents/dojojin-keys/license-private.pem` on macOS/Linux —
override with `--private-key` if you keep it elsewhere.

### What you do NOT bring along

These stay on the machine you generated them on. Do not copy them to
the Windows laptop "for convenience":

- `license-private.pem` (the secret — back it up to 1Password instead)
- `licenses-issued/` ledger from a previous machine (start a fresh
  ledger on each issuing machine; reconcile manually as needed)

## Files / dirs we DO NOT track in git

| Path | Why |
|---|---|
| `~/Documents/dojojin-keys/license-private.pem` | Outside the repo. The most sensitive object in this whole system. |
| `licenses-issued/` | Per-customer JWT backups + ledger.csv. PII + license keys. |
| `*-private.pem`, `license-public.pem` | `.gitignore` belts-and-braces in case anyone drops a key in the repo. |

## Threat reminders

1. **The script + private key together = ability to forge any license.**
   Either alone is harmless: the script with no key prints "key not
   found"; the key with no script needs reverse-engineering before it
   can produce a useful forgery.
2. **The public key in `src/license.js` ships to customers.** Anyone
   with a customer artifact can verify license signatures but cannot
   forge them.
3. **A leaked customer license is bounded by `machine_id`.** The
   recipient can use it only on the specific machine it was bound to.
   Copying the JWT to another machine fails `machine_mismatch`. This
   is why we ask for Machine ID *before* issuing.
