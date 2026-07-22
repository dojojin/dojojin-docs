// ============================================================
// Vigil Platform — Edge MQTT Bridge
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Forwards pre-normalized events from the local NanoMQ broker
// to the central EMQX over WSS (WebSocket Secure). NanoMQ's
// built-in bridge does not support WSS — this process fills
// that gap using mqtt.js which handles WebSocket natively.
//
// Flow:
//   Edge ingesters
//     → publish  projects/{site}/{camera_id}/onvif-ej/…
//     → local NanoMQ (mqtt://127.0.0.1:1883)
//     → this bridge subscribes locally, re-publishes centrally
//     → central EMQX (wss://dashboard.dojojin.tech/mqtt)
//     → central mqtt-subscriber.js receives + handleEdgeEvent
//
// QoS: local subscribe QoS 1 → publish QoS 1 (at-least-once)
// Bosch cameras publish native ONVIF-EJ topics without projects/ prefix —
// subscribed separately via BOSCH_FILTER '+/onvif-ej/#'.
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '../../src/.env') });
const mqtt             = require('mqtt');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const QUEUE_DIR       = path.join(__dirname, '../../data/bridge-queue');
const QUEUE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const WATCHDOG_MS     = 90_000;             // 90 s

// Edge snapshot retention — no api-server on edge → this is the only pruner.
const { snapshotInventory, pruneEdgeSnapshots } = require('./snapshot-retention');
const SNAPSHOT_DIR    = process.env.SNAPSHOT_DIR || path.join(__dirname, '../../snapshots');
const EDGE_IMG_DAYS   = parseInt(process.env.EDGE_IMAGE_RETENTION_DAYS, 10); // NaN → module default 7

const LOCAL_URL    = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const REMOTE_URL   = process.env.BRIDGE_BROKER_URL || 'wss://dashboard.dojojin.tech/mqtt';
const SITE_ID      = process.env.EDGE_SITE_ID || 'edge';
const LOCAL_FILTER = `projects/${SITE_ID}/#`;
// Bosch cameras publish to {camera_id}/onvif-ej/... (no projects/ prefix).
const BOSCH_FILTER = '+/onvif-ej/#';
const CONFIG_TOPIC = `projects/${SITE_ID}/_config/cameras`;
// NVR channel scan request (Phase 3): central → edge. Relayed non-retained so a
// stale request never re-fires on reconnect. The reply (_config/scan-result) is
// published by edge-config-agent under projects/{site}/# and rides the normal
// upstream LOCAL_FILTER path back to central — no downstream rule needed.
const SCAN_TOPIC = `projects/${SITE_ID}/_config/scan-nvr`;
// Model detect request (OPT5-EDGE-004): central → edge, one-shot, same shape
// as SCAN_TOPIC. Reply (_config/detect-model-result) rides the normal
// upstream LOCAL_FILTER path back to central — no downstream rule needed.
const DETECT_TOPIC = `projects/${SITE_ID}/_config/detect-model`;
// Delete-media request (OPT5-EDGE-005): central → edge, one-shot, same shape
// as DETECT_TOPIC/SCAN_TOPIC. Reply (_config/delete-media-result) rides the
// normal upstream LOCAL_FILTER path back to central — no downstream rule needed.
const DELETE_MEDIA_TOPIC = `projects/${SITE_ID}/_config/delete-media`;

const REMOTE_OPTS = {
  clientId:        `vigil-edge-bridge-${SITE_ID}-${process.pid}`,
  clean:           true,
  reconnectPeriod: 5_000,
  connectTimeout:  15_000,
  keepalive:       60,
  username:        process.env.BRIDGE_USERNAME,
  password:        process.env.BRIDGE_PASSWORD,
};

const LOCAL_OPTS = {
  clientId:        `vigil-edge-bridge-local-${process.pid}`,
  clean:           true,
  reconnectPeriod: 2_000,
  connectTimeout:  10_000,
  username:        process.env.MQTT_SUBSCRIBER_USER || undefined,
  password:        process.env.MQTT_SUBSCRIBER_PASSWORD || undefined,
};

let forwarded = 0;
let queued    = 0; // msgs buffered to disk (will replay on reconnect)
let evicted   = 0; // msgs dropped at byte cap (truly lost)
let lastRemoteUp = Date.now();
let replaying    = false;

// ── Queue helpers ────────────────────────────────────────────
function ensureQueueDir() { fs.mkdirSync(QUEUE_DIR, { recursive: true }); }

// Recover any messages left in an orphaned .replay dir from a previous crash mid-replay.
function drainOrphanedReplay() {
  const tempDir = QUEUE_DIR + '.replay';
  try {
    const files = fs.readdirSync(tempDir);
    if (!files.length) { try { fs.rmdirSync(tempDir); } catch {} return; }
    ensureQueueDir();
    for (const f of files) {
      try { fs.renameSync(path.join(tempDir, f), path.join(QUEUE_DIR, f)); } catch {}
    }
    try { fs.rmdirSync(tempDir); } catch {}
    console.log(`[bridge] startup: recovered ${files.length} msgs from orphaned replay dir`);
  } catch {} // tempDir doesn't exist = normal startup
}
drainOrphanedReplay();

function queueBytes() {
  try {
    return fs.readdirSync(QUEUE_DIR).reduce((sum, f) => {
      try { return sum + fs.statSync(path.join(QUEUE_DIR, f)).size; } catch { return sum; }
    }, 0);
  } catch { return 0; }
}

function enqueue(topic, payload) {
  ensureQueueDir();
  if (queueBytes() >= QUEUE_MAX_BYTES) {
    // drop oldest file when cap exceeded — this is a genuine loss
    try {
      const oldest = fs.readdirSync(QUEUE_DIR).sort()[0];
      if (oldest) fs.unlinkSync(path.join(QUEUE_DIR, oldest));
    } catch {}
    evicted++;
    // Fire the moment it happens, not just via the periodic heartbeat below —
    // OPT5-EDGE-001 (2026-07-21): a real outage today queued to ~88% of
    // QUEUE_MAX_BYTES with zero active alert; this is the earliest possible
    // signal that data is actually being lost, not just queued.
    console.warn(`[bridge] ⚠️  queue cap hit — evicting oldest message (evicted=${evicted} total, cap=${Math.round(QUEUE_MAX_BYTES / (1024 * 1024))}MB)`);
  }
  queued++;
  const fname = `${Date.now()}-${process.hrtime.bigint()}.json`;
  fs.writeFileSync(
    path.join(QUEUE_DIR, fname),
    JSON.stringify({ topic, payload: payload.toString('base64') }),
  );
}

async function replayQueue() {
  // ponytail: single replay at a time; next connect drains remainder
  if (replaying) return;
  replaying = true;
  try {
    let files;
    try { files = fs.readdirSync(QUEUE_DIR).sort(); } catch { return; }
    if (!files.length) return;

    const tempDir = QUEUE_DIR + '.replay';
    try { fs.renameSync(QUEUE_DIR, tempDir); } catch { return; }
    ensureQueueDir(); // fresh dir for new drops during replay

    console.log(`[bridge] replaying ${files.length} queued msgs`);
    let replayed = 0;
    for (const f of files) {
      try {
        const { topic, payload } = JSON.parse(fs.readFileSync(path.join(tempDir, f)));
        const buf = Buffer.from(payload, 'base64');
        await new Promise((resolve) => {
          remote.publish(topic, buf, { qos: 1, retain: false }, (err) => {
            if (err) { enqueue(topic, buf); } // re-queue on fail
            else     { replayed++; }
            resolve();
          });
        });
      } catch (e) { console.error('[bridge] replay item error:', e.message); }
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    console.log(`[bridge] replay done replayed=${replayed}/${files.length}`);
  } finally {
    replaying = false;
  }
}

// ── Connect to central EMQX ─────────────────────────────────
let remote;

function wireRemote(r) {
  r.on('connect', () => {
    console.log(`[bridge] remote CONNECTED → ${REMOTE_URL}`);
    lastRemoteUp = Date.now();
    r.subscribe([CONFIG_TOPIC, SCAN_TOPIC, DETECT_TOPIC, DELETE_MEDIA_TOPIC], { qos: 1 }, (err) => {
      if (err) console.error('[bridge] config subscribe error:', err.message);
      else     console.log(`[bridge] subscribed config: ${CONFIG_TOPIC} + ${SCAN_TOPIC} + ${DETECT_TOPIC} + ${DELETE_MEDIA_TOPIC}`);
    });
    replayQueue().catch((e) => console.error('[bridge] replayQueue error:', e.message));
    startLocal();
  });

  // ── Relay _config/* : central EMQX → local NanoMQ ──────
  r.on('message', (topic, payload) => {
    if (topic !== CONFIG_TOPIC && topic !== SCAN_TOPIC && topic !== DETECT_TOPIC && topic !== DELETE_MEDIA_TOPIC) return;
    if (!local?.connected) {
      console.warn('[bridge] config received but local broker not ready');
      return;
    }
    // cameras config is retained (edge reloads on reconnect); a scan request is
    // one-shot, so relay it non-retained.
    local.publish(topic, payload, { qos: 1, retain: topic === CONFIG_TOPIC }, (err) => {
      if (err) console.error('[bridge] config relay error:', err.message);
      else     console.log(`[bridge] config relayed → local: ${topic}`);
    });
  });

  r.on('reconnect', () => console.log('[bridge] remote reconnecting…'));
  r.on('error',     (e) => console.error('[bridge] remote error:', e.message));
  r.on('offline',   ()  => console.log('[bridge] remote offline'));
}

function forceReconnect() {
  console.warn('[bridge] watchdog: force reconnecting remote');
  replaying = false; // abort in-progress replay; next connect re-drains queue
  try { remote.end(true); } catch {}
  remote = mqtt.connect(REMOTE_URL, REMOTE_OPTS);
  wireRemote(remote);
}

remote = mqtt.connect(REMOTE_URL, REMOTE_OPTS);
wireRemote(remote);

// ── Local subscriber (started after remote is ready) ─────────
let local = null;

function startLocal() {
  if (local) return;
  local = mqtt.connect(LOCAL_URL, LOCAL_OPTS);

  local.on('connect', () => {
    console.log(`[bridge] local  CONNECTED → ${LOCAL_URL}`);
    local.subscribe(LOCAL_FILTER, { qos: 1 }, (err) => {
      if (err) console.error('[bridge] subscribe error:', err.message);
      else     console.log(`[bridge] subscribed: ${LOCAL_FILTER}`);
    });
    local.subscribe(BOSCH_FILTER, { qos: 1 }, (err) => {
      if (err) console.error('[bridge] bosch subscribe error:', err.message);
      else     console.log(`[bridge] subscribed: ${BOSCH_FILTER}`);
    });
  });

  local.on('message', (topic, payload) => {
    // _config/cameras and _config/scan-nvr are downlink-only (central → edge via
    // the relay above, r.on('message') a few lines up). LOCAL_FILTER's wildcard
    // (projects/{site}/#) also matches them, so without this guard each relayed
    // message loops forever: remote→local relay lands here → re-forwarded to
    // remote → this bridge's OWN remote subscription (SCAN_TOPIC/CONFIG_TOPIC)
    // receives it again → relays to local again. CONFIG_TOPIC was already
    // guarded (its retain:true made the failure mode a write storm to
    // cameras-config.json); SCAN_TOPIC was missed — live incident 2026-07-16:
    // unthrottled local↔remote bounce, ~139 msg/s sustained, each one driving a
    // real _fetchJpeg() HTTP request on edge-config-agent → thousands of
    // concurrent sockets to the target NVRs ("socket hang up" storm).
    if (topic === CONFIG_TOPIC || topic === SCAN_TOPIC || topic === DETECT_TOPIC || topic === DELETE_MEDIA_TOPIC) return;

    // Bosch cameras publish {camera_id}/onvif-ej/... with no site prefix (BOSCH_FILTER
    // above). Central's handleEdgeEvent cross-check (mqtt-subscriber.js) trusts the
    // projects/<site>/ prefix to know which site a camera_id is allowed to claim —
    // re-prefix here so Bosch gets the same site attribution Hik/Dahua/LPR already have.
    if (!topic.startsWith('projects/')) topic = `projects/${SITE_ID}/${topic}`;

    if (!remote.connected) {
      enqueue(topic, payload);
      if (queued % 50 === 0) console.warn(`[bridge] remote offline — queued=${queued} evicted=${evicted}`);
      return;
    }
    remote.publish(topic, payload, { qos: 1, retain: false }, (err) => {
      if (err) {
        console.error('[bridge] publish error — re-queuing:', err.message);
        enqueue(topic, payload); // ponytail: covers in-flight failures (option A)
        return;
      }
      forwarded++;
      if (forwarded % 100 === 0) console.log(`[bridge] forwarded=${forwarded} queued=${queued} evicted=${evicted}`);
    });
  });

  local.on('error',   (e) => console.error('[bridge] local error:', e.message));
  local.on('offline', ()  => console.log('[bridge] local offline'));
}

// ── Heartbeat ────────────────────────────────────────────────
setInterval(() => {
  const r = remote.connected ? 'up' : 'down';
  const l = local?.connected  ? 'up' : 'down';
  const qBytes = queueBytes();
  console.log(`[bridge] heartbeat remote=${r} local=${l} forwarded=${forwarded} queued=${queued} evicted=${evicted} queued_bytes=${qBytes}`);
  // OPT5-EDGE-001 (2026-07-21) — warn well before eviction actually starts.
  // Today's outage reached ~88% of QUEUE_MAX_BYTES with no signal until this
  // investigation happened to notice it; 80% gives a runway to act.
  const fullPct = qBytes / QUEUE_MAX_BYTES;
  if (fullPct >= 0.8) {
    console.warn(`[bridge] ⚠️  queue at ${Math.round(fullPct * 100)}% of cap (${Math.round(qBytes / (1024 * 1024))}MB/${Math.round(QUEUE_MAX_BYTES / (1024 * 1024))}MB) — eviction imminent if remote stays down`);
  }
  if (!remote.connected) {
    const downMs = Date.now() - lastRemoteUp;
    if (downMs >= WATCHDOG_MS) {
      console.warn(`[bridge] watchdog: remote down ${Math.round(downMs / 1000)}s — force reconnecting`);
      forceReconnect();
    }
    return;
  }

  let pm2 = [];
  try {
    const raw = execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 4000 });
    pm2 = JSON.parse(raw).map(p => ({
      name:      p.name,
      status:    p.pm2_env.status,
      restarts:  p.pm2_env.restart_time || 0,
      uptime_ms: p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
    }));
  } catch (e) { console.warn('[bridge] pm2 jlist failed:', e.message); }

  let disk = null;
  try {
    const df = execFileSync('df', ['-k', '/'], { encoding: 'utf8' });
    const parts = df.trim().split('\n')[1].trim().split(/\s+/);
    const total = parseInt(parts[1], 10);
    const avail = parseInt(parts[3], 10);
    disk = {
      free_gb:  +(avail / (1024 * 1024)).toFixed(1),
      total_gb: +(total / (1024 * 1024)).toFixed(1),
    };
  } catch (e) { console.warn('[bridge] df failed:', e.message); }

  const payload = JSON.stringify({
    ts: Date.now(), pm2, disk,
    snapshots: snapshotInventory(SNAPSHOT_DIR),   // cheap: oldest date-dir + count (readdir, no recursion)
    bridge: { forwarded, queued, evicted, remote: r, local: l },
  });
  remote.publish(
    `projects/${SITE_ID}/_edge/heartbeat`,
    payload,
    { qos: 1, retain: false },
    (err) => { if (err) console.warn('[bridge] heartbeat publish failed:', err.message); }
  );
}, 60_000);

// ── Snapshot prune — hourly, async (never blocks forwarding). Dir-age drop of
// expired Bosch scene date-dirs; guards live in snapshot-retention.js.
const _prune = () => pruneEdgeSnapshots(SNAPSHOT_DIR, EDGE_IMG_DAYS).catch(e => console.warn('[bridge] prune error:', e.message));
setTimeout(_prune, 120_000);        // once shortly after boot
setInterval(_prune, 3600_000);      // then hourly

// ── Graceful shutdown ────────────────────────────────────────
function shutdown() {
  console.log('[bridge] shutting down…');
  local?.end(true);
  remote.end(true);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
