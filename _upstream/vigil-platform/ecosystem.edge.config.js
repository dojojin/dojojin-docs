// ============================================================
// Vigil Platform — PM2 ecosystem config (EDGE / Linux)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Edge device subset of ecosystem.config.js, adapted for Ubuntu/Linux.
// Runs ONLY the ingest/receive apps that belong on a Site Edge box
// (VIGIL-ARCH-003): pull from cameras / receive HTTP push and
// publish metadata to the LOCAL NanoMQ broker, which bridges up to
// the central EMQX (dashboard.dojojin.tech).
//
// api-server / mqtt-subscriber / report / alert run centrally — NOT here.
//
// Usage:
//   pm2 start ecosystem.edge.config.js
//   pm2 save && pm2 startup    # autostart on boot (systemd)
// ============================================================
const fs = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, 'src');
const ROOT = __dirname;

// Which broker pm2 app to run — 'nanomq' (default) or 'mosquitto' (E1 pilot,
// docs/reports/2026-09-27_mosquitto-migration-plan.md §9). Process env wins
// (how E1c starts it: `EDGE_BROKER=mosquitto pm2 start ...`), else fall back
// to the line in src/.env (how it runs day to day after `pm2 save`). A
// one-line read, not `require('dotenv')`, on purpose: dotenv only lives in
// src/node_modules (this file sits at repo root, outside that resolution
// path) and pulling every other var in src/.env into this process to read
// one flag would be both the wrong tool and unnecessary exposure.
function readEdgeBrokerFromEnvFile() {
  const envFile = path.join(SRC, '.env');
  if (!fs.existsSync(envFile)) return undefined;
  const m = fs.readFileSync(envFile, 'utf8').match(/^EDGE_BROKER=(.*)$/m);
  return m ? m[1].trim() : undefined;
}
const EDGE_BROKER = (process.env.EDGE_BROKER || readEdgeBrokerFromEnvFile() || 'nanomq').trim();

const base = {
  cwd: SRC,
  watch: false,
  autorestart: true,
  min_uptime: '10s',
  restart_delay: 3000,
  max_restarts: 15,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  interpreter: '/usr/bin/node',
  env: {
    NODE_NO_WARNINGS: '1',
  },
};

// NanoMQ — local MQTT broker. Ingesters publish here; bridge forwards to
// central EMQX. Runs in foreground (PM2 manages the process). Default broker.
const nanomqApp = {
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
};

// Mosquitto — pilot alternative broker (E1). Installed from the
// mosquitto-dev PPA at /usr/sbin/mosquitto; the apt-shipped systemd unit is
// masked (E1b) so this pm2 process is what owns port 1883 instead. Config
// rendered by scripts/edge-render-mosquitto-conf.sh from
// edge/mosquitto.conf.template into ~/.config/vigil/mosquitto.conf. Selected
// via EDGE_BROKER=mosquitto — never runs alongside nanomq (both want :1883).
const mosquittoApp = {
  name: 'mosquitto',
  cwd: ROOT,
  script: '/usr/sbin/mosquitto',
  args: `-c ${process.env.HOME}/.config/vigil/mosquitto.conf`,
  interpreter: 'none',
  watch: false,
  autorestart: true,
  min_uptime: '5s',
  restart_delay: 3000,
  max_restarts: 20,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
};

const brokerApp = EDGE_BROKER === 'mosquitto' ? mosquittoApp : nanomqApp;

module.exports = {
  apps: [
    brokerApp,
    {
      // Hikvision ISAPI ingester — polls/receives Hik cameras → NanoMQ.
      ...base,
      name: 'hikvision',
      script: 'ingesters/hikvision-isapi.js',
    },
    {
      // Dahua CGI ingester — Dahua cameras → NanoMQ.
      ...base,
      name: 'dahua',
      script: 'ingesters/dahua-cgi.js',
    },
    {
      // LPR + face push HTTP receiver (Hik Alarm Server / Dahua ANPR push).
      ...base,
      name: 'lpr-receiver',
      script: 'lpr-receiver.js',
    },
    {
      // HC1 — HikCentral Professional face-match ingester, live poll mode.
      // Pulls faceMatchRecord every HCP_LIVE_POLL_SEC (default 60s, lookback
      // 15m) and publishes FaceRecognition events → NanoMQ → central. Feed is
      // sparse (~1/day). EDGE_MODE + HCP creds come from src/.env via dotenv.
      // Backfill history with:
      //   node ingesters/hcp-face-matches.js --since=YYYY-MM-DD --until=YYYY-MM-DD --populate
      ...base,
      name: 'hcp-face-matches',
      script: 'ingesters/hcp-face-matches.js',
      args: '--live',
    },
    {
      // Edge Config Agent — receives _config/cameras from NanoMQ (relayed from
      // central by edge-bridge), writes cameras-config.json, publishes ack.
      ...base,
      name: 'edge-config-agent',
      script: 'edge-config-agent.js',
      min_uptime: '5s',
      restart_delay: 3000,
    },
    {
      // Edge MQTT Bridge — forwards projects/{site}/# + Bosch +/onvif-ej/#
      // from local NanoMQ to central EMQX over WSS. NanoMQ built-in bridge
      // does not support WSS; this Node.js process fills that gap.
      ...base,
      name: 'edge-bridge',
      script: 'edge/bridge.js',          // src/edge/bridge.js
      min_uptime: '5s',
      restart_delay: 5000,
    },
    {
      // Cloudflare Tunnel — exposes {site}.dojojin.tech → lpr-receiver :3003.
      // Wrapper script sources src/.env then execs cloudflared with the local
      // ingress config (config/cloudflared.yml).
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
