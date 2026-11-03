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
require('dotenv').config({ path: require('path').join(__dirname, '../../src/.env'), quiet: true });
const mqtt             = require('mqtt');
const { execFileSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const { drainOrphanedReplay, replay: replayFromDisk } = require('./bridgeQueue');
const bridgePaths = require('./bridgePaths');
const QUEUE_DIR       = path.join(__dirname, '../../data/bridge-queue');
const QUEUE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const WATCHDOG_MS     = 90_000;             // 90 s

// Edge snapshot retention — no api-server on edge → this is the only pruner.
const { snapshotInventory, folderInventory, pruneEdgeFolder } = require('./snapshot-retention');
const { sampleHost, hostSpec } = require('../helpers/hostMetrics');
const { sampleStorage } = require('../helpers/storageHealth');
const { sampleTunnel } = require('../helpers/connectivityHealth');
const { snapshotDir } = require('../helpers/snapshotDir');
const env = require('../config');
const SNAPSHOT_DIR    = snapshotDir();
const EDGE_IMG_DAYS   = env.int('EDGE_IMAGE_RETENTION_DAYS'); // ไม่ตั้ง → undefined → ตกไป default 7 ของ pruner

const LOCAL_URL    = env.str('MQTT_BROKER_URL');
const REMOTE_URL   = env.str('BRIDGE_BROKER_URL');
// หลายเส้นทางเรียงตามลำดับ (src/edge/bridgePaths.js) · ไม่ตั้ง = เส้นเดียวแบบเดิม
const REMOTE_URLS  = (() => { const l = bridgePaths.parseUrls(env.str('BRIDGE_BROKER_URLS')); return l.length ? l : [REMOTE_URL]; })();
const _path = { idx: 0, since: Date.now(), downSince: Date.now(), probeOk: 0, switches: 0 };
const SITE_ID      = env.str('EDGE_SITE_ID');
const LOCAL_FILTER = `projects/${SITE_ID}/#`;
// Bosch cameras publish to {camera_id}/onvif-ej/... (no projects/ prefix).
const BOSCH_FILTER = '+/onvif-ej/#';
const CONFIG_TOPIC = `projects/${SITE_ID}/_config/cameras`;
// R1 — per-site image retention. Retained like CONFIG_TOPIC so a bridge that
// boots, or reconnects after the tunnel drops, gets the policy again without
// anybody pressing anything on central.
const RETENTION_TOPIC = `projects/${SITE_ID}/_config/retention`;
// Declared beside the topic it belongs to, not down by the pruner: the message
// handler reads it and only avoids the temporal dead zone by accident of
// evaluation order otherwise.
const _retention = { events_days: undefined, min_free_gb: undefined, lpr_days: undefined, face_days: undefined, hold: false };
// 🧊 hold (ไซต์ปิดปรับปรุง) เก็บลงไฟล์ด้วย — local handler ทิ้ง RETENTION_TOPIC (กัน loop) ⇒ boot ตอนเส้น
// central ขาด _retention จะว่าง แล้ว _prune รอบแรก (120 วิ) ลบตามอายุ ทั้งที่ไซต์กำลังปิดปรับปรุง
// มีไฟล์ = hold จนกว่า central ส่ง hold:false มา
const HOLD_FILE = path.join(__dirname, '../../data/retention-hold');
_retention.hold = fs.existsSync(HOLD_FILE);
let _lastPrune = null;
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
// Service control (H2, 2026-07-27) — same downlink-only shape as the four above.
// Reply (_config/svc-result) rides the normal uplink.
const SVC_TOPIC = `projects/${SITE_ID}/_config/svc`;
// Camera reboot (2026-07-27) — downlink-only, reply rides the normal uplink.
const REBOOT_TOPIC = `projects/${SITE_ID}/_config/reboot-device`;
// Storage scan/purge (2026-08-24) — เหมือน DETECT/DELETE_MEDIA: คำสั่งขาลงต้องอยู่ใน
// DOWNLINK_TOPICS ไม่งั้น bridge ไม่ดึงลงมาให้ agent เห็นเลย และไม่มี error ที่ไหน
// (เจอตอนทดสอบ end-to-end 2026-08-24: agent มีโค้ดครบแต่ไม่เคยได้รับคำสั่ง)
// ส่วนขากลับ (_config/storage-*-result) ขึ้นทาง LOCAL_FILTER ปกติ ไม่ต้องมีกฎเพิ่ม
const STOR_SCAN_TOPIC  = `projects/${SITE_ID}/_config/storage-scan`;
const STOR_PURGE_TOPIC = `projects/${SITE_ID}/_config/storage-purge`;
// Push MQTT settings into a Bosch camera (Mosquitto migration phase B1) —
// downlink-only, one-shot, reply rides the normal upstream path back to
// central like every other *-result topic (same shape as REBOOT_TOPIC).
const CAMERA_MQTT_TOPIC = `projects/${SITE_ID}/_config/camera-mqtt`;

// Every downlink command topic in one list. They must appear in ALL THREE
// places below — remote subscribe, relay allow-check, and the local-side loop
// guard — and keeping them in a single array is what stops a fifth command from
// being added to two of the three. Missing the guard is not a small bug: the
// 2026-07-16 incident was a local<->remote bounce at ~139 msg/s.
const DOWNLINK_TOPICS = [CONFIG_TOPIC, RETENTION_TOPIC, SCAN_TOPIC, DETECT_TOPIC, DELETE_MEDIA_TOPIC, SVC_TOPIC, REBOOT_TOPIC, STOR_SCAN_TOPIC, STOR_PURGE_TOPIC, CAMERA_MQTT_TOPIC];

const REMOTE_OPTS = {
  clientId:        `vigil-edge-bridge-${SITE_ID}-${process.pid}`,
  clean:           true,
  reconnectPeriod: 5_000,
  connectTimeout:  15_000,
  keepalive:       60,
  // อ่านดิบ ไม่ผ่าน env.str() โดยตั้งใจ: mqtt.js แยก '' (ผู้ใช้ว่าง) ออกจาก undefined
  // (ไม่ส่ง field เลย) — env.str() แปลง '' เป็น default ซึ่งเปลี่ยนความหมายตรงนี้
  username:        process.env.BRIDGE_USERNAME,
  password:        process.env.BRIDGE_PASSWORD,
};

const LOCAL_OPTS = {
  clientId:        `vigil-edge-bridge-local-${process.pid}`,
  clean:           true,
  reconnectPeriod: 2_000,
  connectTimeout:  10_000,
  username:        env.str('MQTT_SUBSCRIBER_USER'),
  password:        env.str('MQTT_SUBSCRIBER_PASSWORD'),
};

let forwarded = 0;
let queued    = 0; // msgs buffered to disk (will replay on reconnect)
let evicted   = 0; // msgs dropped at byte cap (truly lost)
let lastRemoteUp = Date.now();
let replaying    = false;
let replayGen    = 0;     // forceReconnect() เพิ่มค่านี้ ⇒ รอบ replay เดิมหยุดเองที่ข้อความถัดไป

// ── Queue helpers ────────────────────────────────────────────
function ensureQueueDir() { fs.mkdirSync(QUEUE_DIR, { recursive: true }); }

// Recover anything an interrupted replay left behind. With per-message unlink
// (see bridgeQueue.js) whatever is still there was genuinely never confirmed.
{
  const recovered = drainOrphanedReplay(QUEUE_DIR);
  if (recovered) console.log(`[bridge] startup: recovered ${recovered} unconfirmed msgs from orphaned replay dir`);
}

// ข้อความที่ publisher กันไว้เพราะใหญ่เกินเพดาน broker (src/edge/publisher.js)
// นับจากไฟล์บนดิสก์ ไม่ใช่ตัวแปรในหน่วยความจำ — publisher รันอยู่ใน process ของ
// ingester **คนละตัวกับ bridge** จึงแชร์ตัวนับกันตรง ๆ ไม่ได้ · ดิสก์คือช่องทางเดียว
// ที่ทั้งสองฝั่งเห็นตรงกัน และมันรอดการ restart ด้วย
const { OVERSIZED_DIR } = require('./publisher');   // แหล่งเดียว ห้ามประกาศ path ซ้ำ
function oversizedCount() {
  try { return fs.readdirSync(OVERSIZED_DIR).length; } catch { return 0; }
}

// ตัวนับ queued ในหน่วยความจำเพี้ยนจากไฟล์จริงได้ (hkt 2026-10-17: 7415 vs 4104 ไฟล์) — heartbeat ใช้ค่านี้แทน
function queueCount() {
  try { return fs.readdirSync(QUEUE_DIR).length; } catch { return 0; }
}

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
  const gen = replayGen;
  try {
    const before = (() => { try { return fs.readdirSync(QUEUE_DIR).length; } catch { return 0; } })();
    if (!before) return;
    console.log(`[bridge] replaying ${before} queued msgs`);
    const r = await replayFromDisk(QUEUE_DIR, (topic, buf) => new Promise((resolve) => {
      // Resolve only on PUBACK. bridgeQueue deletes the file on true and moves
      // it back to the queue on false, so an interrupted run can never re-send
      // what the broker already confirmed (the vss duplicate storm, 2026-07-31).
      remote.publish(topic, buf, { qos: 1, retain: false }, (err) => resolve(!err));
    }), { shouldStop: () => gen !== replayGen || !remote.connected });
    queued = queueCount();
    console.log(`[bridge] replay done replayed=${r.sent}/${r.total}` +
                (r.requeued ? ` requeued=${r.requeued}` : '') +
                (r.timedOut ? ` timedOut=${r.timedOut}` : '') +
                (r.stopped ? ` stopped=${r.stopped}` : ''));
    // Something is wrong with the link rather than with any one message; say so
    // once here rather than leaving a silent four-day stall to be found later.
    if (r.timedOut) console.warn(`[bridge] ⚠️  ${r.timedOut} publish(es) never confirmed — link is unhealthy; they stay queued`);
  } finally {
    replaying = false;
  }
}

// ── Connect to central EMQX ─────────────────────────────────
let remote;

function wireRemote(r) {
  r.on('connect', () => {
    if (r !== remote) return;   // client เก่าที่ถูกสั่งปิดไปแล้ว
    console.log(`[bridge] remote CONNECTED → ${REMOTE_URLS[_path.idx]} (${bridgePaths.pathName(REMOTE_URLS[_path.idx])})`);
    lastRemoteUp = Date.now();
    _path.downSince = null;
    r.subscribe(DOWNLINK_TOPICS, { qos: 1 }, (err) => {
      if (err) console.error('[bridge] config subscribe error:', err.message);
      else     console.log(`[bridge] subscribed config: ${DOWNLINK_TOPICS.join(' + ')}`);
    });
    replayQueue().catch((e) => console.error('[bridge] replayQueue error:', e.message));
    startLocal();
  });

  // ── Relay _config/* : central EMQX → local NanoMQ ──────
  r.on('message', (topic, payload) => {
    if (!DOWNLINK_TOPICS.includes(topic)) return;
    // Retention is consumed HERE, not by edge-config-agent: the pruner lives in
    // this process. Still relayed below so a restart re-reads it from the local
    // retained copy even if central is unreachable at that moment.
    if (topic === RETENTION_TOPIC) {
      try {
        const cfg = JSON.parse(payload.toString());
        // Only overwrite what actually arrived. A field absent from the payload
        // must leave the current value alone rather than reset it to undefined
        // and silently drop the site back to the built-in default.
        if ('events_days' in cfg) _retention.events_days = cfg.events_days;
        if ('min_free_gb' in cfg) _retention.min_free_gb = cfg.min_free_gb;
        if ('lpr_days'   in cfg)  _retention.lpr_days = cfg.lpr_days;    // R3, not acted on yet
        if ('face_days'  in cfg)  _retention.face_days = cfg.face_days;  // R3
        if ('hold' in cfg) {
          _retention.hold = cfg.hold === true;
          try {
            if (_retention.hold) { fs.mkdirSync(path.dirname(HOLD_FILE), { recursive: true }); fs.writeFileSync(HOLD_FILE, String(Date.now())); }
            else fs.rmSync(HOLD_FILE, { force: true });
          } catch (e) { console.warn('[bridge] retention hold file:', e.message); }
        }
        console.log(`[bridge] retention policy: ${JSON.stringify(_retention)}`);
      } catch (e) { console.warn('[bridge] retention payload unreadable:', e.message); }
    }
    if (!local?.connected) {
      console.warn('[bridge] config received but local broker not ready');
      return;
    }
    // cameras config is retained (edge reloads on reconnect); a scan request is
    // one-shot, so relay it non-retained.
    local.publish(topic, payload, { qos: 1, retain: topic === CONFIG_TOPIC || topic === RETENTION_TOPIC }, (err) => {
      if (err) console.error('[bridge] config relay error:', err.message);
      else     console.log(`[bridge] config relayed → local: ${topic}`);
    });
  });

  r.on('reconnect', () => console.log('[bridge] remote reconnecting…'));
  r.on('error',     (e) => console.error('[bridge] remote error:', e.message));
  r.on('offline',   ()  => console.log('[bridge] remote offline'));
  r.on('close',     ()  => { if (r === remote && _path.downSince == null) _path.downSince = Date.now(); });
}

function forceReconnect(idx = _path.idx) {
  if (idx !== _path.idx) {
    console.warn(`[bridge] path ${bridgePaths.pathName(REMOTE_URLS[_path.idx])} → ${bridgePaths.pathName(REMOTE_URLS[idx])}`);
    _path.idx = idx; _path.since = Date.now(); _path.probeOk = 0; _path.switches++;
  } else {
    console.warn('[bridge] watchdog: force reconnecting remote');
  }
  _path.downSince = Date.now();   // เส้นใหม่ได้เวลาของตัวเองครบ FAILOVER_MS
  // เดิมตั้ง replaying = false ตรงนี้ ⇒ รอบเก่ายังวนต่อขณะที่รอบใหม่เริ่มบนไฟล์ชุดเดียวกัน ⇒ ทิ้ง .replay ค้าง
  // แล้วทุกรอบหลังจากนั้นคืน 0/0 (hkt/hdy 2026-10-17) · ตอนนี้สั่งรอบเก่าหยุด แล้วให้ finally ปลด flag เอง
  replayGen++;
  const old = remote;
  remote = mqtt.connect(REMOTE_URLS[_path.idx], REMOTE_OPTS);
  try { old.end(true); } catch {}
  wireRemote(remote);
}

remote = mqtt.connect(REMOTE_URLS[0], REMOTE_OPTS);
wireRemote(remote);

// ── เลือกเส้นทาง (ทำงานเฉพาะเมื่อมีมากกว่า 1 เส้น) ─────────────
if (REMOTE_URLS.length > 1) {
  console.log(`[bridge] paths: ${REMOTE_URLS.map((u, i) => `${i + 1}.${bridgePaths.pathName(u)}`).join(' ')}`);
  setInterval(() => {
    const to = bridgePaths.decide({ ..._path, count: REMOTE_URLS.length, connected: !!remote?.connected }, Date.now());
    if (to != null) forceReconnect(to);
  }, 5_000);

  // อยู่เส้นสำรองอยู่ → ลองต่อเส้นหลักแยกต่างหากทุก 5 นาที (clientId คนละตัว ไม่ชนกับ session จริง)
  let probing = false;
  setInterval(() => {
    if (_path.idx === 0 || probing) return;
    probing = true;
    const p = mqtt.connect(REMOTE_URLS[0], { ...REMOTE_OPTS, clientId: `${REMOTE_OPTS.clientId}-probe`, reconnectPeriod: 0, connectTimeout: 8_000 });
    const done = (ok) => {
      if (!probing) return;
      probing = false;
      _path.probeOk = ok ? _path.probeOk + 1 : 0;
      console.log(`[bridge] probe ${bridgePaths.pathName(REMOTE_URLS[0])}: ${ok ? 'ok' : 'fail'} (${_path.probeOk}/${bridgePaths.FAILBACK_OK})`);
      try { p.end(true); } catch {}
    };
    p.once('connect', () => done(true));
    p.once('error', () => done(false));
    p.once('close', () => done(false));
    setTimeout(() => done(false), 10_000);
  }, 300_000);
}

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
    if (DOWNLINK_TOPICS.includes(topic)) return;

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
  queued = queueCount();
  const r = remote.connected ? 'up' : 'down';
  const l = local?.connected  ? 'up' : 'down';
  const qBytes = queueBytes();
  console.log(`[bridge] heartbeat remote=${r} local=${l} forwarded=${forwarded} queued=${queued} evicted=${evicted} queued_bytes=${qBytes}`);

  // คิวที่เหลือค้างต้องมีคนมาปลุก แม้ลิงก์จะไม่ขาดอีกเลย
  //
  // 🔴 เดิม replayQueue() ถูกเรียกจากจุดเดียวคือตอน remote CONNECTED โดยตั้งใจว่า
  // "รอบหน้าที่ต่อใหม่จะเก็บที่เหลือเอง" — ซึ่งจริงเฉพาะตอนลิงก์ยังกระตุกเป็นระยะ
  // พอลิงก์นิ่งสนิทกลับกลายเป็นว่า **ไม่มีอะไรมาปลุกอีกเลย** ⇒ ข้อความที่ถูก
  // requeue ไว้นอนค้างถาวร · ของจริงที่ vss 2026-08-14: หลังเอาใบพิษออกแล้วลิงก์
  // เสถียร 222 ใบที่เหลือก็นิ่งสนิท ไม่ขยับเลยแม้แต่ใบเดียว
  // ยิ่งซ่อนดี เพราะ heartbeat ยังขึ้น remote=up ทุกนาทีเหมือนทุกอย่างปกติ
  if (remote?.connected && queued > 0 && !replaying) {
    replayQueue().catch((e) => console.error('[bridge] replayQueue error:', e.message));
  }
  // OPT5-EDGE-001 (2026-07-21) — warn well before eviction actually starts.
  // Today's outage reached ~88% of QUEUE_MAX_BYTES with no signal until this
  // investigation happened to notice it; 80% gives a runway to act.
  const fullPct = qBytes / QUEUE_MAX_BYTES;
  if (fullPct >= 0.8) {
    console.warn(`[bridge] ⚠️  queue at ${Math.round(fullPct * 100)}% of cap (${Math.round(qBytes / (1024 * 1024))}MB/${Math.round(QUEUE_MAX_BYTES / (1024 * 1024))}MB) — eviction imminent if remote stays down`);
  }
  if (!remote.connected) {
    const downMs = Date.now() - lastRemoteUp;
    if (REMOTE_URLS.length < 2 && downMs >= WATCHDOG_MS) {   // หลายเส้น = bridgePaths.decide() ดูแลแทน
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

  // Performance sample rides the heartbeat rather than getting its own timer:
  // this already runs at exactly the cadence the graphs want, and one publish is
  // cheaper than two. Never allowed to break the heartbeat — a heartbeat with no
  // metrics still keeps the site from being marked down, the reverse is useless.
  let host = null;
  try { host = sampleHost(); } catch (e) { console.warn('[bridge] host metrics failed:', e.message); }

  // Storage layout + mdraid state. `disk` above is root only and cannot see a
  // media array at all; this is what tells central whether snapshots are still
  // landing on their own disk and whether the mirror is still whole.
  let storage = null;
  try { storage = sampleStorage(SNAPSHOT_DIR); } catch (e) { console.warn('[bridge] storage metrics failed:', e.message); }

  // cloudflared systemd status — this box's own half of the tunnel. Tailscale
  // status is NOT sampled here: central's own tailnet view already reports
  // every peer's Online state, so that half is central-only (see health.js).
  let tunnel = null;
  try { tunnel = sampleTunnel(); } catch (e) { console.warn('[bridge] tunnel status failed:', e.message); }

  const payload = JSON.stringify({
    ts: Date.now(), pm2, disk, host, spec: hostSpec(), storage, tunnel,
    // LAN URL this site's Bosch cameras actually connect to (migration 248) —
    // read at send time (not cached at module load) so a live .env edit +
    // pm2 restart of just the bridge picks it up without redeploying.
    // Same env var pushMqttSettings already uses to write the broker INTO
    // cameras (helpers/boschRcp.js) — this just also reports it upward.
    camera_broker_url: env.str('EDGE_CAMERA_BROKER_URL') || null,
    snapshots: snapshotInventory(SNAPSHOT_DIR),   // cheap: oldest date-dir + count (readdir, no recursion)
    // Per-folder date-dir listing. This is what lets central answer "if I set
    // N days, how many days go away?" from numbers the site actually has —
    // no simulate-a-delete mode, which is one more thing that could be wrong in
    // the direction that destroys data. Names only, no du: a byte count over
    // 178 GB of small files is not something to do every hour.
    inventory: Object.fromEntries(['events', 'lpr', 'face']
      .map(f => [f, folderInventory(SNAPSHOT_DIR, f)])
      .filter(([, v]) => v && v.dirs > 0)),
    // What this site is ACTUALLY running, and when it last did anything — the
    // only way central can tell "policy delivered" from "policy published".
    // effective = the number the pruner will actually use, resolved the same way
    // it resolves it. Reporting the raw `?? EDGE_IMG_DAYS` showed `null` for a
    // site with no policy and no env var, because JSON.stringify(NaN) is null —
    // so a site quietly running the built-in 7 looked unconfigured on screen.
    retention: {
      ..._retention,
      effective_events_days: Number.isFinite(_retention.events_days) ? _retention.events_days
        : (Number.isFinite(EDGE_IMG_DAYS) ? EDGE_IMG_DAYS : 7),
      env_days: Number.isFinite(EDGE_IMG_DAYS) ? EDGE_IMG_DAYS : null,
    },
    last_prune: _lastPrune,
    // `dropped` = ข้อความที่ **หายจริง** ไม่ใช่แค่รอคิว · central อ่านฟิลด์ชื่อนี้
    // ไปลง edge_status.bridge_dropped (mqtt-subscriber.js ~683) มาตั้งแต่ต้น
    // แต่ฝั่งนี้ส่งมาแค่ `evicted` ⇒ ชื่อไม่ตรงกัน คอลัมน์เลยเป็น NULL ทั้ง 4 ไซต์
    // มาตลอด · รวม 2 ทางที่ของหายจริงเข้าด้วยกัน: คิวเต็มจนต้องเขี่ยทิ้ง (evicted)
    // และข้อความที่ใหญ่เกินเพดาน broker จนส่งไม่ได้ (data/oversized/)
    bridge: { forwarded, queued, evicted, dropped: evicted + oversizedCount(), remote: r, local: l,
              path: bridgePaths.pathName(REMOTE_URLS[_path.idx]), path_since: new Date(_path.since).toISOString(),
              path_switches: _path.switches },
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
//
// Values start undefined, not 0: until a policy arrives, pruneEdgeSnapshots'
// own `Number.isFinite(days) ? days : 7` fallback must win. A 0 here would mean
// "delete everything" on the first tick after a boot with the tunnel down.
//
// R3 — events/ keeps its historical behaviour (a default applies even with no
// policy), but lpr/ and face/ prune ONLY when a site has an explicit number.
// They never inherit events_days: those images can be primary evidence, and
// "nobody set it" must mean "keep everything", not "keep 7 days because that is
// what the snapshots folder happens to use".
// pruneEdgeFolder log เฉพาะตอนลบจริง รอบที่ไม่ลบอะไรจึงเงียบสนิท และรอบที่ "ข้าม"
// เพราะยังไม่ได้รับ policy ก็เงียบเหมือนกัน สามสถานะนี้แยกจากกันไม่ได้จาก log เลย
// (24 ส.ค. 2569: ไล่หาว่าทำไม lpr ที่ hkt ไม่ถูกลบ ต้องเดาว่ารอบ prune เคยรันหรือยัง
//  ทั้งที่คำตอบคือ "รันแล้วแต่ข้าม เพราะ lpr_days ยังเป็น undefined")
// สรุปหนึ่งบรรทัดต่อรอบ พร้อมบอกว่าโฟลเดอร์ไหนถูกข้ามและเพราะอะไร
// 🧊 hold = ไซต์ปิดปรับปรุง: ทุกโฟลเดอร์ข้ามการลบตามอายุ เหลือแค่ลบตาม min_free_gb (pruneEdgeFolder warn เอง)
const _prune = async () => {
  const out = {};
  const skipped = [];
  const hold = _retention.hold === true;
  try {
    out.events = await pruneEdgeFolder(SNAPSHOT_DIR, 'events',
      _retention.events_days ?? EDGE_IMG_DAYS, { minFreeGb: _retention.min_free_gb, hold });
    for (const [folder, days] of [['lpr', _retention.lpr_days], ['face', _retention.face_days]]) {
      if (!Number.isFinite(days)) { skipped.push(folder); continue; }   // null/undefined = ไม่ลบเลย
      out[folder] = await pruneEdgeFolder(SNAPSHOT_DIR, folder, days, { minFreeGb: _retention.min_free_gb, hold });
    }
    _lastPrune = { at: Date.now(), skipped, ...out };
    const done = Object.entries(out)
      .map(([f, r]) => `${f}=${(r && r.removed) || 0}`).join(' ');
    console.log(`[edge-prune] รอบเสร็จ${hold ? ' (🧊 hold — ไม่ลบตามอายุ)' : ''} · ลบ ${done}` +
      (skipped.length ? ` · ข้าม ${skipped.join(',')} (ยังไม่ได้รับ retention policy จาก central)` : ''));
  } catch (e) { console.warn('[bridge] prune error:', e.message); }
};
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
