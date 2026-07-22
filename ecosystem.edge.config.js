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
  env: {
    NODE_NO_WARNINGS: '1',
  },
};

module.exports = {
  apps: [
    {
      // NanoMQ — local MQTT broker. Ingesters publish here; bridge forwards to
      // central EMQX. Runs in foreground (PM2 manages the process).
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
