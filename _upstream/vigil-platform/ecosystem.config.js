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

// เส้นทางสำรองของ edge-bridge (เจ้าของเลือก 2026-10-18 · ลำดับอยู่ใน src/edge/bridgePaths.js):
// central เปิด ssh -R เข้าไปที่ edge ⇒ บน edge เห็น broker ของ central ที่ 127.0.0.1:18830
// วิ่งเส้นเดียวกับ SSH (tunnel ของ edge ลง bkk06/sin) ไม่ผ่าน anycast ที่ NT พาไปยุโรป
// -R bind ที่ loopback ของ edge เท่านั้น (sshd default GatewayPorts no) · ไซต์ใหม่ = เพิ่มชื่อ host ที่นี่
const MQTT_TUNNEL_HOSTS = ['sshhkt', 'sshhdy', 'sshnrw', 'sshvss3', 'sshvss', 'sshbma'];
const mqttTunnel = (host) => ({
  name: `mqtt-tunnel-${host.replace(/^ssh/, '')}`,
  script: '/usr/bin/ssh',
  interpreter: 'none',
  args: ['-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
         '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
         '-R', '127.0.0.1:18830:127.0.0.1:1883', host],
  autorestart: true,
  min_uptime: '30s',
  restart_delay: 10000,
  // ponytail: ไม่มีเพดาน — Cloudflare/edge ล่มนาน ๆ ต้องกลับมาเองเมื่อทางเปิด ไม่ใช่ค้าง errored
  max_restarts: 1000000,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
});

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
  interpreter: '/usr/bin/node',
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
      // Phase 1 (AuraFace-v1, Internal Test Only) — ดึง face_embed_queue ไปเรียก
      // edge hkt (/face-engine-embed) แล้วเก็บ face_embeddings + เช็ค blacklist
      ...base,
      name: 'face-embed-worker',
      script: 'face-embed-worker.js',
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
    ...MQTT_TUNNEL_HOSTS.map(mqttTunnel),
  ],
};
