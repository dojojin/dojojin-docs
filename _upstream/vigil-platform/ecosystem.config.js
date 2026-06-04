// ============================================================
// DojoJin Tech Dashboard — PM2 ecosystem config
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
  env: {
    NODE_NO_WARNINGS: '1',
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
  ],
};
