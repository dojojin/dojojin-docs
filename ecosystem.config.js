// ============================================================
// Vigil Platform — PM2 ecosystem config
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @contact   prakasit@dojojin.tech | https://dojojin.tech/
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ------------------------------------------------------------
// Usage:
//   pm2 start ecosystem.config.js      # start / resume all apps
//   pm2 restart ecosystem.config.js    # rolling restart all apps
//   pm2 stop ecosystem.config.js       # stop (keep in PM2 list)
//   pm2 delete ecosystem.config.js     # remove from PM2 list
//   pm2 save                           # persist list for boot
//   pm2 startup                        # install launchd autostart
//
// Or use scripts/services.sh which wraps the above.
// ============================================================
const path = require('path');

const SRC = path.join(__dirname, 'src');

const base = {
  cwd: SRC,
  watch: false,
  autorestart: true,
  min_uptime: '10s',       // crash within 10s → counts as bad restart
  restart_delay: 3000,     // ms to wait before each restart attempt
  max_restarts: 15,        // >15 bad restarts → errored (needs manual pm2 restart)
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  // Pin every app to one explicit LTS runtime (A1+A6, 2026-06-10) — PATH-resolved
  // `node` drifts with the spawning daemon's environment (GOTCHAS #83/#84).
  // Camera-subnet reachability is granted by VigilPM2.app context (GOTCHAS #84),
  // so the runtime can be upgraded without LNP per-binary records.
  // Interpreter changes need `pm2 delete <app> && pm2 start ecosystem.config.js`
  // (restart does not re-read this field) + `pm2 save`.
  interpreter: '/opt/homebrew/opt/node@24/bin/node',
  env: {
    NODE_NO_WARNINGS: '1',
    NODE_ENV: 'production',
  },
};

module.exports = {
  apps: [
    {
      ...base,
      name: 'api-server',
      script: 'api-server.js',
      restart_delay: 2000,
    },
    {
      ...base,
      name: 'mqtt-subscriber',
      script: 'mqtt-subscriber.js',
    },
    {
      ...base,
      name: 'media-recorder',
      script: 'media-recorder.js',
    },
    {
      ...base,
      name: 'hikvision',
      script: 'ingesters/hikvision-isapi.js',
    },
    {
      ...base,
      name: 'dahua',
      script: 'ingesters/dahua-cgi.js',
    },
    {
      ...base,
      name: 'report-worker',
      script: 'report-worker.js',
      restart_delay: 5000,  // give api-server time to be up before worker retries
    },
    {
      ...base,
      name: 'alert-worker',
      script: 'alert-worker.js',
      restart_delay: 3000,
    },
    {
      // CS7 — standalone LPR/face push receiver (127.0.0.1:3003). Stays up across
      // api-server redeploys so the /lpr forward (a downstream gov system's only
      // feed) never drops. Goes LIVE only when the cloudflared ingress is flipped
      // to route /lpr + /face-push here (until then api-server still serves them).
      ...base,
      name: 'lpr-receiver',
      script: 'lpr-receiver.js',
      restart_delay: 3000,
    },
  ],
};
