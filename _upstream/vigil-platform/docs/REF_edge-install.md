# Vigil Edge Node — Installation & Setup Guide

> **Living Doc role:** `REF_` — Operator installation runbook
> **Target hardware:** Intel N150 mini PC (or equivalent x86-64 small-form-factor box)
> **Target OS:** Linux Mint 22.x (Ubuntu 24.04 LTS base) — what the production `vss` edge
> actually runs. Any Ubuntu-24.04-base distro works identically (systemd, apt, same
> packages); see "Why Mint" below. Fleet rule: new sites use the same OS as `vss`.
> **Author:** Derived from WSL2 POC (VIGIL-ARCH-003), site code `vss`, 2026-06 ·
> OS updated to match production reality 2026-07-14
>
> For executing a NEW site deploy step-by-step, use the condensed runbook:
> [`docs/REF_edge-site-checklist.md`](REF_edge-site-checklist.md). This file is the deep reference.
>
> **Why pure Linux over WSL2:**
> WSL2 worked for the POC but has operational complexity that pure Linux avoids entirely:
> - No `netsh` port forwarding needed for Bosch cameras (port 1883 is directly exposed)
> - No WSL2 IP address changing on every reboot
> - Standard `systemd` autostart (no Windows Task Scheduler dependency)
> - Cloudflared runs as a proper systemd service, not a PM2-wrapped Windows workaround
>
> **Why Mint (desktop) over Ubuntu Server:**
> Edge sites have no resident ops staff. A desktop lets anyone plug in a monitor and
> troubleshoot on-site, and GUI remote tools (RustDesk/AnyDesk) work out of the box.
> The edge workload is light — desktop overhead is negligible on the N150.
> **Desktop-distro footguns — set these on every box (server distros don't have them):**
> - Disable suspend/sleep + screen lock (Power settings) — a sleeping box = site down
> - Disable automatic-restart from Update Manager
> - Verify PM2 + cloudflared run as systemd services WITHOUT a desktop login session
>   (reboot and check `pm2 list` over ssh before ever logging into the GUI)

---

## Architecture Overview

```
┌─── Edge Node (N150 / Linux Mint) ──────────────────────────┐
│                                                             │
│  Cameras (same LAN)          PM2-managed processes          │
│  ┌──────────────┐            ┌──────────────────────────┐   │
│  │ Hikvision    │──ISAPI────▶│ hikvision (ingester)     │   │
│  │ Dahua        │──CGI──────▶│ dahua (ingester)         │   │
│  │ Bosch        │──MQTT─────▶│ NanoMQ :1883             │   │
│  │ LPR camera   │──HTTP─────▶│ lpr-receiver :3003       │   │
│  └──────────────┘            └───────────┬──────────────┘   │
│                                          │ MQTT publish      │
│                              ┌───────────▼──────────────┐   │
│                              │ edge-bridge (Node.js)    │   │
│                              │ NanoMQ → central EMQX    │   │
│                              │ via WSS (Cloudflare)     │   │
│                              └───────────┬──────────────┘   │
│                                          │                   │
│                              ┌───────────▼──────────────┐   │
│                              │ edge-config-agent        │   │
│                              │ receives cameras-config  │   │
│                              │ from central → local file│   │
│                              └──────────────────────────┘   │
│                                                             │
│  Internet egress via:                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ cloudflared tunnel → dashboard.dojojin.tech          │   │
│  │   vss.dojojin.tech → lpr-receiver :3003 (LPR push)  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                    │ WSS / MQTT over Cloudflare Tunnel
                    ▼
┌─── Central (macOS / VPS) ───────────────────────────────────┐
│  EMQX :8883 (MQTT over TLS)                                 │
│  mqtt-subscriber → PostgreSQL                               │
│  api-server → Dashboard                                     │
└─────────────────────────────────────────────────────────────┘
```

**8 PM2 processes are defined in `ecosystem.edge.config.js`** (the list below is generated from
that file — if they ever disagree, the file wins):

| # | Name | Script | Role |
|---|---|---|---|
| 1 | `nanomq` | `~/.local/bin/nanomq` | Local MQTT broker (no external auth needed) |
| 2 | `hikvision` | `src/ingesters/hikvision-isapi.js` | Polls Hik cameras via ISAPI |
| 3 | `dahua` | `src/ingesters/dahua-cgi.js` | Polls Dahua cameras via CGI |
| 4 | `lpr-receiver` | `src/lpr-receiver.js` | HTTP push receiver for LPR / face |
| 5 | `hcp-face-matches` | `src/ingesters/hcp-face-matches.js` | Pulls face-match records from HikCentral Professional (`--live`, 60s poll) |
| 6 | `edge-config-agent` | `src/edge-config-agent.js` | Syncs cameras-config.json from central |
| 7 | `edge-bridge` | `src/edge/bridge.js` | Forwards MQTT from NanoMQ → central EMQX |
| 8 | `cloudflared` | `scripts/edge-cloudflared.sh` | Cloudflare tunnel (LPR ingress + MQTT WSS) |

> Not every site runs all eight. A site with no Dahua cameras leaves `dahua` stopped (GOTCHAS
> #100), and only sites wired to HikCentral Professional run `hcp-face-matches` — that one also
> refuses to start without `BLACKLIST_SECRET_KEY`, by design.

---

## Prerequisites

### Hardware
- Intel N150 (or any x86-64, ≥4 GB RAM, ≥32 GB eMMC/SSD)
- Wired LAN connection to the same switch as IP cameras
- Internet access (for Cloudflare tunnel to reach central)

### Accounts & secrets (obtain from central admin before starting)
- `TUNNEL_TOKEN` — Cloudflare Tunnel token for this site (from Zero Trust → Tunnels)
- `BRIDGE_USERNAME` / `BRIDGE_PASSWORD` — EMQX credentials for the edge MQTT user
- `CAMERA_SECRET_KEY` — AES-256-GCM key that decrypts camera passwords in cameras-config.json  
  **Must be identical to the key on central** (`src/.env` → `CAMERA_SECRET_KEY`)
- `EDGE_SITE_ID` — site code (e.g. `vss`)

### Known edge sites

| Site code | Edge node name | Admin access |
|---|---|---|
| `hkt` | `sshhkt` (`sshhkt.dojojin.tech`) | Cloudflare Access SSH — `ssh sshhkt` |
| `hdy` | `sshhdy` (`sshhdy.dojojin.tech`) | Cloudflare Access SSH — `ssh sshhdy` |
| `vss` | `sshvss` (`sshvss.dojojin.tech`) | Cloudflare Access SSH — `ssh sshvss` |
| `rmutr-v` | `sshvss3` (`sshvss3.dojojin.tech`) | Cloudflare Access SSH — `ssh sshvss3` |

> `rmutr-v` and `vss3` are the same edge node (site code: `rmutr-v`, ssh alias: `sshvss3`, Linux user: `vss3`).
> To enable SSH on a new edge site, see Step 5.5 below.

> `hkt` (Phuket) is new — previously this site only had push-only cameras reaching
> central directly (HKT01/HKT02 face push via `POST /face-push/:token`, see
> ROADMAP.md IM3-R), no edge node of its own. This is the first real edge box for
> that site.

### Software versions (tested)
| Software | Version |
|---|---|
| Linux Mint | 22.x (Ubuntu 24.04 LTS "Noble" base) |
| Node.js | v22.22.1 |
| npm | 9.x |
| PM2 | latest (npm install -g) |
| NanoMQ | v0.24.14-3 |
| Cloudflared | 2026.6.1 |

---

## Step-by-Step Installation

> Examples below use user `vigil` / `/home/vigil`. Substitute your actual box user/home
> The real ones follow no single pattern — `phuket-edge`, `hdy-edge`, `vss2`, `vss3`.
> Read them off `~/.ssh/config` on central rather than guessing from the site code.

### Step 1 — Install Linux Mint 22

Standard Linux Mint install (same version as the `vss` box). After install:
- Set a static IP (e.g. `192.168.10.100`) via NetworkManager
  (Network settings GUI, or `nmtui` over ssh) — cameras need to reach this box reliably
- Create user `vigil` (or your preferred username)
- Install + enable OpenSSH for remote management: `sudo apt install -y openssh-server`
- **Desktop footguns (see header):** disable suspend/sleep + screen lock in Power
  settings, and disable automatic-restart in Update Manager

After install, update the system:
```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2 — Install Node.js v22

Use NodeSource for a specific version (avoids outdated apt package):
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should print v22.x.x
npm --version
```

### Step 3 — Install PM2 globally

```bash
sudo npm install -g pm2
pm2 --version
```

> **Alternative (no sudo):** `npm install --prefix ~/.local pm2` and add `~/.local/bin` to `PATH`
>
> ⚠️ **Do not install PM2 through nvm.** Every working site has PM2 in a system path
> (`/usr/bin/pm2` or `/usr/local/bin/pm2`). A PM2 that lives under `~/.nvm/versions/node/vXX/bin`
> drags that version-pinned path into the systemd unit at `pm2 startup` time — see the warning in
> Step 12. If you already did, fix it before enabling autostart:
> `sudo npm install -g pm2 && npm uninstall -g pm2 && command -v pm2   # must be /usr/bin/pm2`

### Step 4 — Install NanoMQ (no-sudo, user-local)

NanoMQ is a lightweight MQTT broker optimized for edge devices. Install to `~/.local`:

```bash
# Create directory
mkdir -p ~/.local/nanomq ~/.local/bin

# NOTE (2026-06): the .tar.gz release asset is gone — releases ship .deb/.rpm only.
# Extract the .deb with dpkg-deb (no sudo, same usr/local/bin layout):
wget -q https://github.com/nanomq/nanomq/releases/download/0.24.14/nanomq-0.24.14-linux-amd64.deb \
  -O /tmp/nanomq.deb
dpkg-deb -x /tmp/nanomq.deb ~/.local/nanomq
ln -sf ~/.local/nanomq/usr/local/bin/nanomq ~/.local/bin/nanomq

# Add to PATH (add to ~/.bashrc for persistence)
export PATH="$HOME/.local/bin:$PATH"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# Verify
nanomq --version
```

**Configure NanoMQ** — create `~/.local/nanomq/usr/local/etc/nanomq.conf`:
```bash
mkdir -p ~/.local/nanomq/usr/local/etc
cat > ~/.local/nanomq/usr/local/etc/nanomq.conf << 'EOF'
mqtt {
    property_size = 32
    max_packet_size = 4MB   # metadata only, images never cross MQTT (decision #209); measured real max ~5.3KB — OPT5-EDGE-003
    max_mqueue_len = 2048
    retry_interval = 10s
    keepalive_multiplier = 1.25
    max_inflight_window = 2048
    max_awaiting_rel = 10s
    await_rel_timeout = 10s
}
listeners.tcp {
    bind = "0.0.0.0:1883"
}
listeners.ws {
    bind = "0.0.0.0:8083/mqtt"
}
http_server {
    port = 8081
    limit_conn = 2
    username = admin
    password = public
    auth_type = basic
}
log {
    to = [file, console]
    level = warn
    dir = "/tmp"
    file = "nanomq.log"
    rotation {
        size = 10MB
        count = 5
    }
}
auth {
    # Anonymous access: fine for local-only broker (not exposed to internet)
    allow_anonymous = true
    no_match = allow
    deny_action = ignore
}
EOF
```

> **GOTCHA #97:** NanoMQ built-in bridge does NOT support WSS (WebSocket Secure).
> Do NOT use it. The Node.js `edge-bridge.js` process handles the WSS bridge using mqtt.js.

### Step 5 — Install Cloudflared

```bash
# Preferred: apt official repo (auto-updates with the system)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
# (the ~/.local/bin binary method below still works for no-sudo installs)

# Alternative (no sudo):
mkdir -p ~/.local/bin
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -O ~/.local/bin/cloudflared
chmod +x ~/.local/bin/cloudflared
cloudflared --version
```

### Step 5.5 — Remote SSH access (Cloudflare Access)

SSH access to an edge node requires **three independent layers**, each with its own failure mode.
Set them up in order and verify each before moving to the next.

#### Layer 1: Tunnel Public Hostname (SSH type)

In Cloudflare Zero Trust:
1. Navigate to **Tunnels** → (your tunnel name)
2. Click **Public Hostnames** → **Add a public hostname**
3. Configure:
   - **Subdomain:** `ssh<site>` (e.g., `sshhkt`, `sshhdy`, `sshvss`, `sshvss3`)
   - **Domain:** `dojojin.tech`
   - **Type:** `SSH` (not HTTP)
   - **URL:** `localhost:22`
4. **Save hostname**

**Verify Layer 1:** Run `cloudflared access ssh --hostname sshhkt.dojojin.tech` on central — it should
connect to the tunnel (authentication comes next; it will not let you in yet).
Use the tunnel hostname, **not** `ssh sshhkt.dojojin.tech` — plain SSH to that name bypasses the
`ProxyCommand` entirely and just times out against a port that was never exposed to the internet,
which looks identical to a missing hostname and sends you chasing the wrong layer.

#### Layer 2: Access Policy (Service Auth)

Back in Cloudflare Zero Trust:
1. Navigate to **Access** → **Applications** → find the SSH hostname you just created
   (it should be auto-registered; if not, create it manually with type "SSH")
2. Click to open the application, then **Policies** tab
3. If no policy exists, **Add a policy**:
   - **Policy name:** `SSH-<site>`
   - **Action:** `Service Auth` (⚠️ **NOT** `Allow` — this is the most common mistake; see gotcha below)
   - **Rules:** Add a rule with selector `Service Token` → `matches` → select the service token for this site
   - **Save**

**Verify Layer 2:** Run `ssh -v sshhkt` on central (the alias, so the `ProxyCommand` is used) — if policy is set to `Service Auth` and token is correct, cloudflared should silently forward to step 3. If policy is `Allow` instead → ssh will hang then drop you into a browser login flow (confusing because the token is actually valid — the wrong Action type forces browser auth even for service tokens).

#### Layer 3: SSH authorized_keys on the edge

On the edge box, append the **public key** of central's SSH user to `~/.ssh/authorized_keys`:

```bash
# On the edge box:
mkdir -p ~/.ssh
# Append central's public key — on central: cat ~/.ssh/id_ed25519.pub
echo "ssh-ed25519 AAAA... vigil-central" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

> ⚠️ **Gotcha:** If the edge has `PasswordAuthentication no` in `/etc/ssh/sshd_config` (which it should —
> it's the correct security setting), you **cannot use `ssh-copy-id`** because it needs to log in with a password
> first to install the key. This is a chicken-and-egg problem. Instead, someone with access to the edge
> (via console, RDP, or an existing SSH session) must manually append the key to `~/.ssh/authorized_keys`
> and set permissions. Once the key is in place, future SSH logins work without a password.

**Verify Layer 3:** Run `ssh sshhkt 'hostname && whoami'` on central — if all three layers are set up correctly, this returns the edge hostname and username without prompting for anything or showing a URL.

#### Troubleshooting SSH connection failures

If `ssh sshhkt` fails, diagnose by layer:

1. **DNS doesn't resolve or times out → Layer 1 problem**
   - Verify the Public Hostname exists in Cloudflare Zero Trust
   - Verify type is `SSH`, not HTTP
   - Verify URL points to `localhost:22`

2. **Connection closes immediately or shows browser URL → Layer 2 problem**
   - Open the SSH application in Cloudflare Zero Trust
   - Check the policy Action: must be `Service Auth`, NOT `Allow`
   - Verify the service token is selected in the rule
   - If using the wrong token (e.g., token for site `vss` when connecting to `hkt`), connection will hang then fail

3. **`Permission denied (publickey)` → Layer 3 problem**
   - Verify the public key is in `~/.ssh/authorized_keys` on the edge (correct permissions: 600 file, 700 dir)
   - Double-check the key is complete and on one line (`ssh-ed25519 AAAA...`)
   - Verify you're connecting with the correct username (`phuket-edge` / `hdy-edge` / `vss2` / `vss3` — they do not follow one pattern)

#### Reference: SSH config on central

Add these aliases to `~/.ssh/config` on central for convenience:

```
Host sshhkt
    HostName sshhkt.dojojin.tech
    ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
    User phuket-edge
    StrictHostKeyChecking no

Host sshhdy
    HostName sshhdy.dojojin.tech
    ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
    User hdy-edge
    StrictHostKeyChecking no

Host sshvss
    HostName sshvss.dojojin.tech
    ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
    User vss2
    StrictHostKeyChecking no

Host sshvss3
    HostName sshvss3.dojojin.tech
    ProxyCommand bash -c 'source ~/.cloudflared/vigil-service-token.env && exec cloudflared access ssh --hostname %h'
    User vss3
    StrictHostKeyChecking no
```

The `vigil-service-token.env` file contains the Cloudflare service token environment variables
(`TunnelServiceToken*`). **One token serves every edge** — the block above is byte-identical across
sites except for `HostName` and `User`. So if a new box won't connect, the fault is never in this
file; walk Layers 1–3 in order instead.

---

### Step 6 — Clone the Vigil Repository

```bash
cd ~
git clone git@github.com:dojojin/vigil-platform.git vigil-platform
# OR via HTTPS:
# git clone https://github.com/dojojin/vigil-platform.git vigil-platform

cd vigil-platform
git checkout main   # ensure you're on main

# Install Node dependencies
cd src
npm install
cd ..
```

### Step 7 — Create `src/.env` (NEVER commit this file)

> `BRIDGE_PASSWORD` is generated on CENTRAL: `node scripts/provision-site.js <site> "<Name>"`
> (creates EMQX user `edge-<site>` + ACL `projects/<site>/#`; password is shown ONCE).

Create `/home/vigil/vigil-platform/src/.env` with the values provided by central admin:

```bash
cat > src/.env << 'EOF'
# ============================================================
# Vigil Platform — EDGE (.env)
# This file is gitignored — contains real secrets.
# ============================================================

# ── Edge mode ─────────────────────────────────────────────
EDGE_MODE=1
EDGE_SITE_ID=vss              # site code from central admin
EDGE_SITE_CODE=vss

# ── Bridge → Central EMQX ─────────────────────────────────
BRIDGE_BROKER_URL=wss://dashboard.dojojin.tech/mqtt
# หลายเส้นทาง เรียงตามลำดับ (src/edge/bridgePaths.js · GOTCHAS #229): Tailscale → SSH -R → Cloudflare
# ต้องมี: edge ติด tag:edge ใน tailnet · central มี pm2 mqtt-tunnel-<site> (เพิ่มชื่อ host ใน MQTT_TUNNEL_HOSTS ของ ecosystem.config.js)
# BRIDGE_BROKER_URLS=mqtt://100.89.1.29:1883,mqtt://127.0.0.1:18830,wss://dashboard.dojojin.tech/mqtt
BRIDGE_USERNAME=edge-vss                # from central EMQX admin
BRIDGE_PASSWORD=REPLACE_WITH_REAL_PW   # from central EMQX admin

# ── Local NanoMQ ──────────────────────────────────────────
MQTT_BROKER_URL=mqtt://127.0.0.1:1883
MQTT_CLIENT_ID=vigil-edge
MQTT_SUBSCRIBER_USER=dashboard-subscriber
MQTT_SUBSCRIBER_PASSWORD=REPLACE_WITH_REAL_PW  # any password (local anon-allow)

# ── DB (intentionally unreachable — edge is DB-less) ──────
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=vigil_platform
DB_USER=vigil_sql
DB_PASSWORD=unused_on_edge

# ── AES-256-GCM key for camera passwords ──────────────────
# CRITICAL: must be identical to CAMERA_SECRET_KEY on central
CAMERA_SECRET_KEY=REPLACE_WITH_CENTRAL_KEY

# ── Data retention ────────────────────────────────────────
# Days to keep Bosch scene snapshots on edge (edge-bridge hourly prune)
EDGE_IMAGE_RETENTION_DAYS=7

# ── Ports ─────────────────────────────────────────────────
LPR_RECEIVER_PORT=3003
FACE_PUSH_BIND=0.0.0.0
FACE_PUSH_PORT=3010
API_PORT=3000

# ── Secrets ───────────────────────────────────────────────
SESSION_SECRET=REPLACE_WITH_64_HEX_CHARS
INTERNAL_API_SECRET=REPLACE_WITH_64_HEX_CHARS
# CRITICAL: both of these must be identical to central's src/.env, not new values
SNAPSHOT_PROXY_SECRET=REPLACE_WITH_CENTRAL_KEY   # missing = every central→edge request (httphost-*, event-broker-*, snapshot proxy) gets 401
BLACKLIST_SECRET_KEY=REPLACE_WITH_CENTRAL_KEY    # missing = hcp-face-matches worker crashes on boot

# ── Edge networking (needed if cameras push face events to this edge) ─
EDGE_MQTT_BROKER=mqtt://127.0.0.1:1883   # local NanoMQ, rarely needs changing
LPR_PUSH_HOST=REPLACE_WITH_THIS_EDGE_LAN_IP   # e.g. 172.29.51.52 — this file is gitignored, so a full OS reinstall or manual .env rebuild loses it silently; re-set it every time you (re)provision a box
# FACE_PUSH_HOST — ⚠️ two call sites in lpr-receiver.js want different shapes
# (unresolved as of 2026-08-18, see GOTCHAS): the Hikvision ISAPI IP check wants
# a bare IP ("172.29.51.52"); the Bosch ONVIF AddEventBroker wants "host:port"
# ("172.29.51.52:1883"). A site using BOTH vendors for face push cannot satisfy
# both today — set it for whichever this site actually uses.
FACE_PUSH_HOST=REPLACE_WITH_THIS_EDGE_LAN_IP_OR_IP_PORT

# ── ONVIF metadata crop — tuning only (Bosch) ─────────────
# The on/off switch is NOT here: it is per camera in the dashboard
# (Camera Settings → "ครอปภาพตามวัตถุ", column cameras.meta_crop, migration
# 164) and arrives on the same config push as snapshot_mode, so a toggle
# takes effect without touching this file or restarting anything. When on,
# the edge subscribes to that camera's ONVIF metadata track over RTSP —
# metadata only, the video track is never requested — and crops each event
# snapshot to the object that triggered it. ~2.5 KB/s and ~0.2% of one core
# per enabled camera. These two only change how the crop is framed:
# META_CROP_PAD=0.12     # padding around the box, as a fraction of its size
# META_CROP_MINPX=40     # skip the crop when either side lands below this

# ── Cloudflare Tunnel ─────────────────────────────────────
TUNNEL_TOKEN=eyJ...   # from Cloudflare Zero Trust → Tunnels
EOF
```

Generate random secrets:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 8 — Create Cloudflared Tunnel Config

> ⚠️ **If the tunnel is run with `--token` (remotely-managed), the local `config/cloudflared.yml`
> ingress is IGNORED — the edge gets pushed config from the Cloudflare Zero Trust dashboard.**
> Do routing as **Public Hostnames in the dashboard**, not this file. See GOTCHAS #94.
> Per site: `<site>.dojojin.tech` → Type **HTTP** → `http://localhost:3003` (lpr-receiver),
> **NOT :3000** (api-server, which does not run on edge). Verify: `curl https://<site>.dojojin.tech/healthz`.

**A) Create `config/cloudflared.yml`** (adjust ingress rules for your site):
```bash
mkdir -p config
cat > config/cloudflared.yml << 'EOF'
tunnel: REPLACE_WITH_TUNNEL_UUID   # from Cloudflare Zero Trust
credentials-file: /home/vigil/.cloudflared/REPLACE_WITH_UUID.json

ingress:
  # LPR push receiver (Hikvision Alarm Server / Dahua ANPR HTTP push)
  - hostname: vss.dojojin.tech
    service: http://localhost:3003
  # Catch-all
  - service: http_status:404
EOF
```

**B) Create `scripts/edge-cloudflared.sh`:**
```bash
cat > scripts/edge-cloudflared.sh << 'EOF'
#!/bin/bash
# Vigil Platform — edge cloudflared launcher
# Sources src/.env (for TUNNEL_TOKEN) then runs cloudflared tunnel.
set -a
source "$(dirname "$0")/../src/.env" 2>/dev/null || true
set +a
exec "${HOME}/.local/bin/cloudflared" \
  tunnel \
  --config "$(dirname "$0")/../config/cloudflared.yml" \
  run \
  --token "${TUNNEL_TOKEN:?TUNNEL_TOKEN not set in src/.env}"
EOF
chmod +x scripts/edge-cloudflared.sh
```

### Step 9 — Create `ecosystem.edge.config.js`

Create at repo root `/home/vigil/vigil-platform/ecosystem.edge.config.js`:
```javascript
// Vigil Platform — PM2 ecosystem config (EDGE / Linux)
const path = require('path');
const SRC  = path.join(__dirname, 'src');
const ROOT = __dirname;

const base = {
  cwd: SRC,
  watch: false,
  autorestart: true,
  min_uptime: '10s',
  restart_delay: 3000,
  max_restarts: 15,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  interpreter: '/usr/bin/node',
  env: { NODE_NO_WARNINGS: '1' },
};

module.exports = {
  apps: [
    {
      name: 'nanomq',
      cwd: ROOT,
      script: `${process.env.HOME}/.local/bin/nanomq`,
      args: `start --conf ${process.env.HOME}/.local/nanomq/usr/local/etc/nanomq.conf`,
      interpreter: 'none',
      watch: false,
      autorestart: true,
      min_uptime: '5s',
      restart_delay: 3000,
      max_restarts: 20,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    },
    { ...base, name: 'hikvision',         script: 'ingesters/hikvision-isapi.js' },
    { ...base, name: 'dahua',             script: 'ingesters/dahua-cgi.js' },
    { ...base, name: 'lpr-receiver',      script: 'lpr-receiver.js' },
    { ...base, name: 'edge-config-agent', script: 'edge-config-agent.js',
      min_uptime: '5s', restart_delay: 3000 },
    { ...base, name: 'edge-bridge',       script: 'edge/bridge.js',
      min_uptime: '5s', restart_delay: 5000 },
    {
      name: 'cloudflared',
      cwd: ROOT,
      script: 'scripts/edge-cloudflared.sh',
      interpreter: '/bin/bash',
      watch: false,
      autorestart: true,
      min_uptime: '5s',
      restart_delay: 5000,
      max_restarts: 20,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    },
  ],
};
```

### Step 10 — Initial `cameras-config.json`

Camera config is automatically synced from central via `edge-config-agent`, but you need a seed file for first boot (otherwise ingesters start with no cameras):

```bash
# Option A: Copy from central (recommended)
# scp central-user@central-ip:~/vigil-platform/cameras-config.json ~/vigil-platform/

# Option B: Create minimal stub (edge-config-agent will overwrite it)
cat > cameras-config.json << 'EOF'
{ "cameras": [] }
EOF
```

### Step 11 — Start All Services

> cloudflared should run as a **systemd service** (per the intro). The ecosystem file still
> lists a `cloudflared` PM2 app — after `pm2 start`, run `pm2 delete cloudflared` so the tunnel
> is owned by systemd only (SSH/ingress then survives PM2 restarts). Then `pm2 save`.

> Start order matters: set `BRIDGE_PASSWORD` → edge-bridge connects (`remote=up local=up`) →
> central pushes cameras → cameras-config.json fills → THEN ensure `dahua` is up.
> `dahua` crash-loops if started with 0 dahua cameras (GOTCHAS #100) — if the site has no
> dahua cameras, leave it stopped.

```bash
cd ~/vigil-platform

# Start all PM2 processes from edge ecosystem
pm2 start ecosystem.edge.config.js
pm2 delete cloudflared        # systemd owns the tunnel; remove the PM2 duplicate

# Check status
pm2 list

# Watch logs
pm2 logs --lines 50
```

Expected PM2 output after ~30 seconds:
```
┌────┬──────────────────────┬─────────┬─────────┬──────────┐
│ id │ name                 │ status  │ restart │ uptime   │
├────┼──────────────────────┼─────────┼─────────┼──────────┤
│  0 │ cloudflared          │ online  │ 0       │ 30s      │
│  1 │ nanomq               │ online  │ 0       │ 30s      │
│  2 │ hikvision            │ online  │ 0       │ 30s      │
│  3 │ dahua                │ online  │ 0       │ 30s      │
│  4 │ lpr-receiver         │ online  │ 0       │ 30s      │
│  5 │ edge-config-agent    │ online  │ 0       │ 30s      │
│  6 │ edge-bridge          │ online  │ 0       │ 30s      │
└────┴──────────────────────┴─────────┴─────────┴──────────┘
```

### Step 12 — Enable Autostart on Boot (systemd)

```bash
# Generate and enable systemd unit
pm2 startup systemd -u vigil --hp /home/vigil
# IMPORTANT: Run the sudo command that pm2 prints, e.g.:
#   sudo env PATH=... pm2 startup systemd -u vigil --hp /home/vigil

# Save current process list
pm2 save
```

> ⚠️ **The line pm2 prints contains a literal `$PATH` — do not paste it as-is if this box has
> nvm installed.** `pm2 startup` snapshots whatever `$PATH` your shell has, and a shell whose
> `.bashrc` prepends nvm produces a unit pinned to `~/.nvm/versions/node/vXX.Y.Z/bin`. The day
> nvm drops that exact version, boot-time autostart breaks with nothing to warn you.
> Every working site has a unit with **no nvm in its PATH** — keep it that way by writing the
> PATH out literally instead of letting the shell expand it:
> ```bash
> env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
>        HOME=$HOME USER=$USER /usr/bin/pm2 startup systemd -u <user> --hp $HOME
> # then run the sudo line it prints (that one is safe — PATH is already literal)
> grep -c nvm /etc/systemd/system/pm2-<user>.service    # must print 0
> ```
> Found the hard way at site `nrw` (2026-08-30): the first reboot came up with no unit at all
> because the regenerate step had failed, and PM2 never started — caught only because the site
> had no cameras yet. **Always reboot once and verify autostart while a new site is still empty.**

On pure Linux this works cleanly. The systemd unit starts PM2 on boot which starts all saved processes.

> **WSL2 note (POC only):** On WSL2, `pm2 startup` generates a systemd unit but WSL2 doesn't use systemd by default. On WSL2 you need `loginctl enable-linger $USER` and a Windows Task Scheduler entry to start WSL2 on boot. Pure Linux avoids all of this.

---

### Step 13 — NTP time server (chrony) for camera clock sync

**Why:** cameras stamp every event with their own clock (`UtcTime`). If a camera's
clock drifts, its events land in the DB at the wrong time → wrong Events-list order,
wrong report buckets, and the snapshot match window mis-fires (see GOTCHAS #103, where
a 3100i ran ~3.5h behind and pushed every event off by 3.5h). Camera LANs are usually
isolated (no internet egress) and security cameras shouldn't reach the internet anyway,
so they need an NTP server **on the camera LAN**. The edge node is the natural fit — it's
on-LAN, always-on, and already internet-synced. But Ubuntu's default `systemd-timesyncd`
is **client-only** (it cannot serve time to other devices), so install `chrony`.

```bash
# Install chrony (auto-disables systemd-timesyncd — they conflict; that's fine)
sudo apt-get install -y chrony

# Serve the camera subnet + keep serving even if the uplink drops.
# 'allow' = answer NTP from the camera LAN; 'local stratum 10' = act as a
# valid (low-priority) source using the edge's own clock when upstream is
# unreachable, so cameras never lose their time source.
sudo tee -a /etc/chrony/chrony.conf >/dev/null <<'EOF'

# --- Vigil edge: serve NTP to camera LAN ---
allow 192.168.10.0/24
local stratum 10
EOF

sudo systemctl restart chrony
```

**Verify (on the edge):**
```bash
systemctl is-active chrony                 # active
sudo ss -lun | grep ':123'                 # listening on 0.0.0.0:123 → serving
chronyc tracking | grep -E 'Stratum|System time'   # System time ~0s; Stratum settles to ~3 once it locks upstream (starts at 10)
chronyc sources                            # upstream pools reachable (Reach 17)
# Self-test that it answers NTP on the LAN IP:
node -e 'const d=require("dgram").createSocket("udp4"),p=Buffer.alloc(48);p[0]=0x1b;d.on("message",m=>{console.log("served:",new Date((m.readUInt32BE(40)-2208988800)*1000).toISOString());process.exit(0)});d.send(p,123,"192.168.10.30")'
```

Then point **every camera's NTP** at the edge IP (`192.168.10.30`) with time mode = **SNTP/NTP** (not Manual):
- **Bosch** (CM → Network → Time, or web UI): set NTP server = edge IP. ⚠️ A non-timezone offset (e.g. 3.5h) means the camera is free-running with **no** NTP client — typing the right time won't hold; it needs a reachable server + mode=SNTP.
- **Dahua / Hikvision** (web UI → Setup → System → Date&Time / NTP): server = edge IP. (Their ONVIF accounts differ from the stored ingest creds, so you can't push this via the edge's ONVIF calls — set it in the web UI.)

Confirm per camera with an ONVIF `GetSystemDateAndTime` query from the edge (`DateTimeType` should read `NTP`, UTC skew ~0). `chronyc clients` (run as root) lists cameras once they start syncing.

> **Footprint:** chronyd is ~2–3 MB RAM, ~0 % CPU; serving NTP for a handful of LAN
> clients is trivial (an N150 — or a Raspberry Pi — serves hundreds of clients). It
> *replaces* `systemd-timesyncd` (don't run both), so net resource change ≈ 0.
> Config persists in `/etc/chrony/chrony.conf`; the service is enabled on boot at install.

---

## Camera Configuration

### Bosch cameras (BVMS / FlexiDome)

Bosch cameras support MQTT natively (ONVIF Profile M). Configure each camera to publish to the edge NanoMQ broker:

**MQTT Broker settings (in Bosch camera web UI → Configuration → Recording → Recording destinations):**
| Setting | Value |
|---|---|
| Protocol | MQTT |
| Broker host | `<edge-node-IP>` (e.g. `192.168.10.100`) |
| Port | `1883` |
| Client ID | `BOSCH_<camera_name>` (must match `camera_id` in cameras-config.json) |
| QoS | 1 |
| Username / Password | (leave empty — NanoMQ allows anonymous) |

**Topic format:** Bosch publishes to `{camera_id}/onvif-ej/{category}/{type}/...`
- No `projects/vss/` prefix (unlike Hikvision/Dahua)
- `src/edge/bridge.js` subscribes to `+/onvif-ej/#` to capture these and forwards them to central EMQX

> ⚠️ **Central EMQX ACL does not cover this topic automatically.** `scripts/provision-site.js`
> grants the edge user `projects/<code>/#` only, so a Bosch camera's `<camera_id>/onvif-ej/#`
> publish is denied by the `no_match=deny` policy — **silently**, because the bridge's *subscribe*
> succeeds and nothing errors at start-up. Add one rule per camera on central when you add a
> Bosch camera that has ONVIF metadata enabled (site `hdy` already carries three such rules):
> ```
> POST /authorization/sources/built_in_database/rules/users/edge-<code>
> { "topic": "<camera_id>/onvif-ej/#", "action": "publish", "permission": "allow" }
> ```
> Verify afterwards with
> `GET /authorization/sources/built_in_database/rules/users/edge-<code>`.

> **Pure Linux advantage:** On pure Linux, the edge box LAN IP is stable and directly reachable.
> On WSL2, you need `netsh interface portproxy` on Windows PowerShell (Admin) to forward
> port 1883 from the Windows host LAN IP to WSL2. This is not needed on pure Linux.

### Hikvision cameras (ISAPI polling)

The Hikvision ingester connects to cameras via HTTP ISAPI and subscribes to the event stream. Configure in `cameras-config.json`:

```json
{
  "cameras": [
    {
      "camera_id": "HIKVISION_CAM01",
      "vendor": "hikvision",
      "ip_address": "192.168.10.55",
      "port": 80,
      "username": "admin",
      "password_enc": "ENCRYPTED_PW"
    }
  ]
}
```

**GOTCHA (insecureHTTPParser):** Older Hikvision firmware (pre-2022) sends non-standard HTTP headers that Node.js v22's strict llhttp parser rejects:
```
Parse Error: Invalid header value char
```
Fix: `insecureHTTPParser: true` is already set in `src/ingesters/hikvision-isapi.js` `http.request()` options. No action needed on install.

**Optional — Hikvision face push (Alarm Server):** Configure in Hikvision web UI:
- Configuration → Network → Advanced → Alarm Host IP: `<edge-node-IP>`
- Alarm Port: `3010` (or whatever `FACE_PUSH_PORT` is set to)
- The `FACE_PUSH_BIND=0.0.0.0` in `.env` allows any interface

### Dahua cameras (CGI polling)

Same as Hikvision — configure in `cameras-config.json` with `"vendor": "dahua"`.
The ingester polls via CGI API. Cameras must be network-reachable from the edge box.

---

## Verification

### Check all processes are running
```bash
pm2 list
# All 7 processes should show "online"
```

### Check NanoMQ connections
```bash
# See who is connected to local NanoMQ
curl -s http://admin:public@localhost:8081/api/v4/clients | \
  python3 -c "import sys,json; d=json.load(sys.stdin); [print(c['clientid']) for c in d.get('data',[])]"
```

### Check edge-bridge is forwarding
```bash
pm2 logs edge-bridge --lines 10 --nostream | grep -E "forwarded|heartbeat"
# Should show: forwarded=N (increasing), remote=up local=up
```

### Check snapshot retention (edge-bridge hourly prune)

Edge-bridge runs an **hourly async prune** of Bosch scene snapshots in `snapshots/events/<YYYY-MM-DD>/` older than `EDGE_IMAGE_RETENTION_DAYS` (default 7). This is the **only snapshot pruner on edge** — there is no api-server to run cleanup. Guard rails: only walks `snapshots/events/`, never touches `lpr/` or other paths, never walks root.

Verify pruning is active:
```bash
# Check edge-bridge log for inventory heartbeat (every 60s)
pm2 logs edge-bridge --lines 20 --nostream | grep -E "snapshot.*oldest|dir_count"
# Output example: snapshot_oldest=2026-06-25, snapshot_dirs=8

# List current snapshot date directories
ls -la snapshots/events/ | grep "^d" | wc -l
```

Edge reports inventory in its 60s heartbeat to central health endpoint → visible in `/api/health/details` → `edge_sites[].snapshot_oldest` + `snapshot_dirs`.

### Check cameras are active in NanoMQ
```bash
# Subscribe and watch for events
/home/vigil/.local/bin/nanomq_cli sub --url mqtt://127.0.0.1:1883 -t '#' --q 0 &
# Wait 30 seconds — you should see events from connected cameras
```

### Check central dashboard
- Log in to the central dashboard
- Camera tiles for this site's cameras should show as "online" within ~60 seconds
- If cameras show "ไม่มีสัญญาณ" (no signal): see Troubleshooting below

### Check central Health page
- Health Check page → an `Edge — <SITE>` card should appear within ~60s, identical layout
  to every other site's card (disk free/total, bridge remote/local, PM2 process list).
  Confirmed generic end-to-end (2026-07-03): the whole chain — `edge-bridge.js` heartbeat
  publish → `mqtt-subscriber.js` `recordEdgeHeartbeat()` → `edge_status` table → `GET
  /api/health/details` → `page-health.js` render — is keyed purely on `site_id` from the
  MQTT topic (`projects/<site>/_edge/heartbeat`), with no hardcoding to any particular site.
  A new site's card appears automatically; no code change is ever needed per site.

### Check cloudflared tunnel
```bash
pm2 logs cloudflared --lines 5 --nostream
# Should show: "Connection registered..."
```

---

## Troubleshooting

### Camera shows "ไม่มีสัญญาณ" on dashboard

1. **Verify edge-bridge is forwarding** — check `forwarded` counter is increasing
2. **Verify events reach central** — on central box:
   ```bash
   pm2 logs mqtt-subscriber --lines 50 --nostream | grep -E "BOSCH|HIKVISION|DAHUA|edge"
   ```
3. **Check `cameras.last_seen` in central DB:**
   ```sql
   SELECT camera_id, last_seen FROM cameras WHERE camera_id IN ('BOSCH_3100i','HIKVISION_CAM01');
   ```
4. **Verify CAMERA_SECRET_KEY matches central** — decrypt test:
   ```bash
   node -e "
   const c=require('./src/crypto-creds');
   const cfg=require('./cameras-config.json');
   cfg.cameras.forEach(cam => {
     try { c.decryptCamCreds(cam); console.log(cam.camera_id,'OK'); }
     catch(e) { console.log(cam.camera_id,'FAIL:', e.message); }
   });
   "
   ```

### `fs.watch` storm (cameras-config.json rewritten every ~50ms)

**Cause:** edge-bridge relays `_config/cameras` retain message to local NanoMQ → local subscriber picks it up → forwards back to remote → remote re-delivers → infinite loop.

**Fix (already in code):** `edge-bridge.js` filters `CONFIG_TOPIC` in the local→remote path:
```javascript
local.on('message', (topic, payload) => {
  if (topic === CONFIG_TOPIC) return; // prevents relay loop
  // ...forward to remote
});
```

If you see the storm: restart edge-bridge (`pm2 restart edge-bridge`).

### `Decrypt error: Unsupported state or unable to authenticate data`

**Cause:** `CAMERA_SECRET_KEY` in `src/.env` does not match the key on central.

**Fix:** Copy the key exactly from central's `src/.env`:
```bash
# On central box:
grep CAMERA_SECRET_KEY src/.env

# On edge box:
# Update the CAMERA_SECRET_KEY line in src/.env with the value above
pm2 restart all
```

### `Parse Error: Invalid header value char` (Hikvision)

**Cause:** Node.js v22 strict HTTP parser. Already fixed in `hikvision-isapi.js` with `insecureHTTPParser: true`. If you see this error, confirm the fix is present:
```bash
grep -n "insecureHTTPParser" src/ingesters/hikvision-isapi.js
```

### Bosch events not forwarding (forwarded count not increasing)

**Cause:** Bosch cameras publish to `{camera_id}/onvif-ej/...` — no `projects/vss/` prefix. `edge-bridge.js` must subscribe to `+/onvif-ej/#` in addition to `projects/${SITE_ID}/#`.

**Verify fix is in edge-bridge.js:**
```bash
grep "BOSCH_FILTER\|onvif-ej" src/edge/bridge.js
# Should show: const BOSCH_FILTER = '+/onvif-ej/#';
```

### `ETIMEDOUT` connecting to a camera

Camera is powered off or not on the same network. Check:
1. `ping <camera-ip>` from edge box — if 100% packet loss, camera is unreachable
2. Verify camera is on the same LAN switch as the edge box
3. Camera config in `cameras-config.json` has correct IP address

---

## Central-Side Requirements

Before the edge node can function fully, the central server needs:

| Requirement | Status | Notes |
|---|---|---|
| EMQX user `edge-<site>` with publish ACL for `projects/<site>/#` | Must configure | Via EMQX dashboard or `scripts/emqx-provision.js` |
| EMQX allows `+/onvif-ej/#` from edge user | Verify `no_match = allow` in EMQX ACL | Bosch native topics |
| Migration 067: `cameras.edge_node` column | Apply on central | Tracks which site each camera belongs to |
| Central `mqtt-subscriber.js` handles `_edge: 1` events | Already merged | `handleEdgeEvent()` function |
| Central pushes `_config/cameras` on change | Already merged via `POST /api/sites/:id/push-config` | Config sync (EC1/EC2) |

> ⚠️ **Known gap — cross-site MQTT isolation (not yet fixed, flagged 2026-07-03):**
> `site-provision.js` adds a per-site **ALLOW** rule for `projects/<code>/#`, but EMQX's
> `no_match` stays `allow` (required today so Bosch's un-prefixed `+/onvif-ej/#` topics keep
> working — see the row above). Net effect: any edge user's credentials (e.g. `edge-bma`) can
> currently publish under `projects/vss/#` too — nothing denies it. This was a non-issue with
> a single site; it becomes a real cross-tenant integrity risk once multiple sites (BMA,
> ภูเก็ต) are live and this platform's white-label model puts different customers' data on
> different sites — a leaked or compromised edge password at one site could inject events
> attributed to another. **Fixing this (flip `no_match` to `deny` + add an explicit ALLOW
> rule for every existing user, including the shared Bosch topic space) is a high-blast-radius
> change that needs its own careful rollout, not a drive-by edit** — propose it as a separate
> piece of work before the second real site goes live with production camera traffic.

---

## Gotchas Index

Gotchas found during the WSL2 POC (2026-06). Numbered to match `GOTCHAS.md`:

| # | Issue | Root cause | Fix | Pure Linux? |
|---|---|---|---|---|
| #97 | NanoMQ built-in bridge doesn't support WSS | NanoMQ bridge only speaks plain MQTT/TCP | Use Node.js edge-bridge.js instead | Same issue |
| #98 | CAMERA_SECRET_KEY mismatch → decrypt error | Edge key ≠ central key | Copy exact key from central `.env` | Same issue |
| #99 | fs.watch storm (config written every 50ms) | edge-bridge relays `_config/cameras` back to local → relay loop | Filter `CONFIG_TOPIC` in local→remote path in edge-bridge.js | Same issue |
| — | Bosch MQTT topics have no `projects/` prefix | Bosch ONVIF-EJ native format: `{cam_id}/onvif-ej/...` | Add `BOSCH_FILTER = '+/onvif-ej/#'` subscription in edge-bridge.js | Same issue |
| — | `Parse Error: Invalid header value char` (Hik) | Node.js v22 strict llhttp + old Hikvision firmware | `insecureHTTPParser: true` in http.request() options | Same issue |
| — | Bosch cameras can't reach NanoMQ (WSL2 only) | WSL2 IP is NATed; Windows host IP is what cameras see | Run `netsh interface portproxy` on Windows (Admin PowerShell) | **Not an issue on pure Linux** |
| — | WSL2 IP changes on reboot | WSL2 dynamic network address | Requires re-running netsh on each boot (or scripting) | **Not an issue on pure Linux** |
| — | PM2 startup on WSL2 requires Windows integration | WSL2 may not run systemd | `loginctl enable-linger` + Windows Task Scheduler | **Clean `pm2 startup` on pure Linux** |
| — | `DAHUA_CAM01` shows in logs even when offline | Camera in cameras-config.json but physically disconnected | Expected — ingester retries until camera comes back; not an error | Same |

---

## File Reference

```
vigil-platform/
├── src/
│   ├── .env                          # GITIGNORED — secrets (create manually)
│   ├── edge/
│   │   ├── bridge.js                 # MQTT bridge process: NanoMQ → central EMQX (WSS)
│   │   └── publisher.js              # Edge publish helper (used by all ingesters)
│   ├── edge-config-agent.js          # EC2: receives cameras config from central
│   └── ingesters/
│       ├── hikvision-isapi.js        # Hik ISAPI ingester (EDGE_MODE aware)
│       └── dahua-cgi.js              # Dahua CGI ingester (EDGE_MODE aware)
├── edge/
│   ├── env.template                  # .env template for new edge installs
│   └── nanomq.conf.template          # NanoMQ config template
├── scripts/
│   └── edge-cloudflared.sh           # Wrapper: sources .env, execs cloudflared
├── config/
│   └── cloudflared.yml               # Cloudflare tunnel ingress rules
├── cameras-config.json               # Camera list (auto-synced from central)
└── ecosystem.edge.config.js          # PM2 app definition for edge (7 processes)
```

**EDGE_MODE pattern — how ingesters work on edge vs central:**

| File | Central (`EDGE_MODE` unset) | Edge (`EDGE_MODE=1`) |
|---|---|---|
| `dahua-cgi.js` | INSERT events + UPDATE last_seen + alertEngine | `publishEdgeEvent()` → NanoMQ → skip DB |
| `hikvision-isapi.js` | INSERT events + UPDATE last_seen + alertEngine | `publishEdgeEvent()` → NanoMQ → skip DB |
| `lpr-core.js` | INSERT events + license_plates | `publishEdgeEvent()` → NanoMQ → skip DB |
| `face-push.js` | INSERT events + appearances | `publishEdgeEvent()` → NanoMQ → skip DB |

---

## Maintenance

### Update the codebase
```bash
cd ~/vigil-platform
git pull origin main
cd src && npm install   # if package.json changed
pm2 restart all
pm2 save
```

### Rotate BRIDGE_PASSWORD
1. Update in EMQX on central
2. Update `BRIDGE_PASSWORD` in edge `src/.env`
3. `pm2 restart edge-bridge`

### Check disk usage
```bash
du -sh ~/.pm2/logs/     # PM2 log rotation (check max_size config)
df -h /                 # disk usage
```

### Manual config push from central (if cameras-config.json gets stale)
```bash
# On central box:
curl -X POST https://dashboard.dojojin.tech/api/sites/vss/push-config \
  -H "Authorization: Bearer <admin-token>"
# edge-config-agent will receive and apply within seconds
```

---

*Document generated from POC on WSL2 (Ubuntu/Windows) — DESKTOP-E3VB3FF, 2026-06-24.*
*Adapted for pure Linux production target (N150 / Linux Mint 22, Ubuntu 24.04 base) — OS section updated 2026-07-14 to match the deployed `vss` box.*
