# REF_edge-site-checklist — Vigil Edge Per-Site Deploy Runbook

> **Living Doc role:** `REF_` — Per-site execution checklist (run this for every new edge site)
> **Companion to:** [`docs/REF_edge-install.md`](REF_edge-install.md) — the deep "how/why" guide.
> This file is the **condensed, parameterized runbook** you tick through on-site.
> Read the deep guide once; then use THIS for Phuket / BMA / any future site.
>
> Derived from the `vss` deploy (2026-06-24). `<SITE>` = lowercase site code (e.g. `phuket`, `bma`).

---

## 0. Per-Site Variables — fill this table FIRST

| Variable | Where it comes from | `vss` example | This site |
|---|---|---|---|
| `<SITE>` (site code) | you choose (a-z0-9-) | `vss` | |
| OS | Linux Mint 22 (Ubuntu 24.04 base) — same as `vss`; disable suspend/screen-lock/auto-restart | Linux Mint 22 | |
| Edge box user / home | OS user on the box | `vss-edge` / `/home/vss-edge` | |
| Edge LAN IP (camera subnet) | `ip -4 addr` on box | `192.168.10.30` | |
| Tunnel name + UUID | Zero Trust → Networks → Tunnels | `vss` / `79802c0c-…` | |
| `BRIDGE_USERNAME` | `edge-<SITE>` | `edge-vss` | |
| `BRIDGE_PASSWORD` | `provision-site.js` output (once) | (secret) | |
| `CAMERA_SECRET_KEY` | central `src/.env` — **must match exactly** | (secret) | |
| Public hostname (LPR/face push) | `<SITE>.dojojin.tech` → `http://localhost:3003` | `vss.dojojin.tech` | |
| SSH hostname (optional mgmt) | `ssh<SITE>.dojojin.tech` (Type SSH + Access app) | `sshvss.dojojin.tech` | |
| Camera count by vendor | from central cameras list | bosch4 / hik2 / dahua2 | |
| `FACE_PUSH_ALLOW` | IPs of face cameras pushing **LAN-direct** to `:3010` (comma-sep) | `192.168.10.235` | |

> ⚠️ `CAMERA_SECRET_KEY` is identical across ALL nodes — **never generate a new one per site** (GOTCHAS #98).
>
> ⚠️ **There are two face-push paths and they authenticate differently — know which one this site uses:**
>
> | Path | Port | Auth | Needs `FACE_PUSH_ALLOW`? |
> |---|---|---|---|
> | LAN-direct → `hikvision` ingester's face alarm server | `3010` | **source IP allowlist** | **yes** |
> | Tunnel → `lpr-receiver` `POST /face-push/:token` | `3003` | per-camera `face_push_token` | no (Cloudflare masks the source IP, so the token identifies the camera) |
>
> For the LAN-direct path, `FACE_PUSH_ALLOW` is **per-site and mandatory**. Its built-in default is
> `192.168.10.235` — the face camera at the first site ever deployed — so any site on another subnet
> answers **403 to every push** and does it **silently**: the camera pushes, the server drops, and it
> looks like the camera was configured wrong (GOTCHAS #133). Note the camera does **not** have to sit
> on the edge box's own subnet; only reachability matters (at `hkt` the box is `10.0.10.50` and the
> face camera is `10.1.100.59`, 1 ms away — LAN-direct is fine, the IP just has to be listed).

---

## 1. Central prep (run on the CENTRAL box, EMQX must be up)

- [ ] Provision the site + its edge MQTT identity (prints `BRIDGE_PASSWORD` **once**):
  ```bash
  cd ~/vigil-platform
  node scripts/provision-site.js <SITE> "<Site Name>"
  ```
  → record `username` (`edge-<SITE>`), `password`, `topic` (`projects/<SITE>/#`).
- [ ] Confirm EMQX user `edge-<SITE>` has publish ACL for `projects/<SITE>/#` **and** `+/onvif-ej/#` (Bosch native topics; `no_match = allow`).
- [ ] Grab `CAMERA_SECRET_KEY` from central `src/.env` (copy verbatim).
- [ ] Add this site's cameras in the central dashboard (so config can push down later).

## 2. Cloudflare prep (Zero Trust dashboard — NOT local files)

> 🔴 The tunnel is **dashboard/remotely-managed**: local `config/cloudflared.yml` ingress is **ignored**; the edge gets pushed remote config. ALL routing = Public Hostnames in the dashboard. (GOTCHAS #94 — this recurred on the `vss` edge deploy.)

- [ ] Tunnel exists for the site (create if needed). Token will go in edge `.env` as `TUNNEL_TOKEN`.
- [ ] **Public Hostname (LPR/face push):** Networks → Tunnels → `<tunnel>` → Public Hostname → Add
  - Subdomain `<SITE>` · Domain `dojojin.tech` · **Type `HTTP`** · URL **`localhost:3003`**
  - ⚠️ **Must be `:3003` (lpr-receiver), NOT `:3000`** — :3000 (api-server) does not run on edge.
- [ ] **(Optional) SSH management** `ssh<SITE>.dojojin.tech` — needs **BOTH**:
  1. Public Hostname **Type `SSH`** · URL `localhost:22` (Type=HTTP → `websocket: bad handshake`)
  2. A **Cloudflare Access** self-hosted app for that hostname (policy allowing your identity)

## 3. Edge box install (run on the EDGE box)

> Full detail in `REF_edge-install.md`. Deltas confirmed on real hardware:

- [ ] Node v22 + PM2 (`sudo npm install -g pm2`)
- [ ] **NanoMQ** — the `.tar.gz` release asset is **gone**; install from `.deb`, no-sudo:
  ```bash
  mkdir -p ~/.local/nanomq ~/.local/bin
  wget -q https://github.com/nanomq/nanomq/releases/download/0.24.14/nanomq-0.24.14-linux-amd64.deb -O /tmp/nanomq.deb
  dpkg-deb -x /tmp/nanomq.deb ~/.local/nanomq        # extracts usr/local/bin/nanomq (no sudo)
  ln -sf ~/.local/nanomq/usr/local/bin/nanomq ~/.local/bin/nanomq
  ```
  then write `~/.local/nanomq/usr/local/etc/nanomq.conf` (template in REF_edge-install.md §4).
- [ ] **cloudflared** — prefer apt official repo (auto-update, `/usr/bin`):
  ```bash
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
  sudo apt-get update && sudo apt-get install -y cloudflared
  ```
- [ ] **cloudflared runs as a systemd service** (owns the tunnel) — NOT inside PM2 (see §5).

## 4. Repo + secrets

- [ ] `git clone … ~/vigil-platform && (cd src && npm install)`
- [ ] Create `src/.env` (chmod 600) — fill from the variables table. Key fields:
  ```
  EDGE_MODE=1
  EDGE_SITE_ID=<SITE>
  EDGE_SITE_CODE=<SITE>
  BRIDGE_BROKER_URL=wss://dashboard.dojojin.tech/mqtt
  # (ทางเลือก แนะนำ) BRIDGE_BROKER_URLS=mqtt://100.89.1.29:1883,mqtt://127.0.0.1:18830,wss://dashboard.dojojin.tech/mqtt
  #   ต้องเพิ่มชื่อ ssh host ของไซต์ใน MQTT_TUNNEL_HOSTS (ecosystem.config.js บน central) + ติด tag:edge ใน tailnet ก่อน · ดู GOTCHAS #229
  BRIDGE_USERNAME=edge-<SITE>
  BRIDGE_PASSWORD=<from provision-site.js>
  MQTT_BROKER_URL=mqtt://127.0.0.1:1883
  EDGE_MQTT_BROKER=mqtt://127.0.0.1:1883
  CAMERA_SECRET_KEY=<exact copy from central>
  LPR_RECEIVER_PORT=3003
  FACE_PUSH_BIND=0.0.0.0
  FACE_PUSH_PORT=3010
  FACE_PUSH_ALLOW=<this site's Hik face camera IPs, comma-separated>
  TUNNEL_TOKEN=<cloudflared tunnel token <tunnel>>
  # SESSION_SECRET / INTERNAL_API_SECRET / MQTT_SUBSCRIBER_PASSWORD = generate per box
  # SNAPSHOT_DIR — omit unless snapshots live off <repo>/snapshots. If you set it,
  # it must be set for EVERY process (they share helpers/snapshotDir.js, so one
  # .env covers them all) — see GOTCHAS #131 for why this used to drift.
  ```
- [ ] Seed `cameras-config.json` = `{ "cameras": [] }` (central pushes the real list once bridge connects).

## 5. Start — ORDER MATTERS

- [ ] Confirm `BRIDGE_PASSWORD` is set BEFORE starting (else edge-bridge loops "Bad username or password").
- [ ] cloudflared: run as **systemd** service (`sudo cloudflared service install` with `/etc/cloudflared/`), then:
  ```bash
  pm2 start ecosystem.edge.config.js
  pm2 delete cloudflared        # systemd owns the tunnel; remove the PM2 duplicate
  ```
- [ ] Wait for edge-bridge `remote=up local=up` → central pushes cameras → `cameras-config.json` fills.
- [ ] **Start `dahua` only after cameras synced** (≥1 dahua camera). With 0 dahua cameras it crash-loops (GOTCHAS #100). If 0 dahua cameras at this site, leave `dahua` stopped.
- [ ] Persist + autostart:
  ```bash
  pm2 save
  pm2 startup systemd -u <user> --hp /home/<user>   # run the sudo line it prints
  ```

## 6. Per-site verification

- [ ] All PM2 processes `online`, restart counts not climbing (`pm2 list`).
- [ ] LPR/face tunnel path: `curl -s https://<SITE>.dojojin.tech/healthz` → `{"ok":true,"app":"lpr-receiver","port":3003}`.
- [ ] edge-bridge: `pm2 logs edge-bridge --nostream | grep heartbeat` → `remote=up local=up`.
- [ ] **Central Health page** (dashboard.dojojin.tech → Health Check): an `Edge — <SITE>` card should appear within ~60s of edge-bridge coming up, same layout as every other site's card (disk, bridge status, PM2 process list). This is the single best confirmation that the whole chain — edge-bridge → central MQTT → DB → `/api/health/details` → dashboard — is wired correctly end-to-end; no code change is needed per site, it's fully generic on `site_id`. If the card doesn't appear after a minute, re-check `BRIDGE_USERNAME`/`BRIDGE_PASSWORD` and the EMQX ACL from step 1.
- [ ] Ingesters connected: hik/dahua logs show `Alert/event Stream connected`. `ping` each camera IP.
- [ ] **Face push — verify the path this site actually uses.** Which cameras do face at all: `node -e "console.log(require('./cameras-config.json').cameras.filter(c=>c.face_push_token).map(c=>c.camera_id+' '+c.ip_address))"`. Then:
  - LAN-direct (`:3010`): `pm2 logs hikvision --nostream | grep 'Face alarm server'` prints the live allowlist. If it shows `192.168.10.235` on any other site, `FACE_PUSH_ALLOW` was never set. Prove it end-to-end — `curl -so /dev/null -w '%{http_code}' -X POST -F x=1 http://<edge-ip>:3010/` must NOT be `403` from an allowed IP.
  - Tunnel (`:3003`): `curl -so /dev/null -w '%{http_code}' -X POST -F x=1 http://127.0.0.1:3003/face-push/<token>` → `200`. No allowlist involved.
  - A quiet log is not proof of health here: with zero pushes arriving, both a working and a broken allowlist look identical (GOTCHAS #133).
- [ ] Bosch: each Bosch camera's MQTT broker host = **edge LAN IP : 1883** (camera-side config).
- [ ] **End-to-end event delivery** — verify with a REAL detection (walk past / vehicle), then watch:
  ```bash
  cd src && node -e "const c=require('mqtt').connect('mqtt://127.0.0.1:1883');c.on('connect',()=>c.subscribe('#'));c.on('message',t=>console.log(t))"
  ```
  > ⚠️ Do NOT treat the edge-bridge `forwarded=N` counter as proof of event flow — it can climb on heartbeats with zero real detections. Confirm actual detection topics + the camera turning "online" on the central dashboard.

---

## Related GOTCHAS (read before debugging)

| # | Issue |
|---|---|
| #94 | Tunnel is dashboard/token-managed → local `config.yml` ignored; route via Zero Trust Public Hostnames |
| #97 | NanoMQ built-in bridge doesn't support WSS → Node.js `edge-bridge` handles it |
| #98 | `CAMERA_SECRET_KEY` must match central exactly — silent decrypt failure otherwise |
| #99 | `CONFIG_TOPIC` relay loop — filtered in `edge-bridge.js` |
| #100 | `dahua` crash-loops with 0 dahua cameras (no keep-alive) — start it only after cameras synced |
| #131 | `SNAPSHOT_DIR` used to be redefined in 10 modules, 8 ignoring the env var — now one `helpers/snapshotDir.js` |
| #132 | Corporate firewall (FortiGate) MITMs TLS → edge-bridge dies on cert verify while cloudflared stays up (QUIC/UDP). Check `openssl s_client` issuer FIRST |
| #133 | `FACE_PUSH_ALLOW` defaults to the first site's camera IP → face pushes silently dropped at every other site |
