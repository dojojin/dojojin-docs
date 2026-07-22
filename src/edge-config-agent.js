// ============================================================
// Vigil Platform — Edge Config Agent
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

// EC2: subscribe _config/cameras from local NanoMQ → write cameras-config.json
// → fs.watch in ingesters triggers live-reload (no restart needed).
// Publishes ack to _config/ack so central can show "applied / pending" status.
//
// Also captures HTTP snapshots from edge cameras (local LAN reachable) and
// publishes them base64-encoded to central via MQTT bridge, so the dashboard
// can display full-scene photos for cameras behind NAT.
//
// Required env:
//   EDGE_SITE_CODE   — site code, e.g. "vss"
//   EDGE_MQTT_BROKER — local broker URL (default: mqtt://localhost:1883)

const mqtt   = require('mqtt');
const fs     = require('fs');
const net    = require('net');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');
const { decryptCamCreds }             = require('./crypto-creds');
const { snapPath }                    = require('./snapshot-path');
const { parseChallenge, buildDigestHeader } = require('./helpers/digestAuth');
const { parseChannelTitles } = require('./ingesters/dahua-channels');
const { detectModel } = require('./model-detect');
const { deleteCameraMedia } = require('./camera-media-delete');
const SNAPSHOT_DIR = path.join(__dirname, '..', 'snapshots');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const SITE = process.env.EDGE_SITE_CODE;
if (!SITE) { console.error('[edge-config] EDGE_SITE_CODE not set — exiting'); process.exit(1); }

const CONFIG_PATH = path.resolve(__dirname, '..', 'cameras-config.json');

// Map of camera_id → decrypted camera config (ip, username, password).
// Seeded from existing file so heartbeat + snapshot fire immediately after restart.
function _loadCameraMap() {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const m = {};
    for (const c of (d.cameras || [])) {
      if (c.camera_id) m[c.camera_id] = decryptCamCreds(c);
    }
    return m;
  } catch { return {}; }
}

let _cameraMap = _loadCameraMap();

const TOPIC_IN  = `projects/${SITE}/_config/cameras`;
const TOPIC_ACK = `projects/${SITE}/_config/ack`;
// NVR channel scan (Phase 3): central publishes a request here (relayed down by
// the bridge); we enumerate the NVR's channels over the LAN and publish the
// reply on _config/scan-result, which rides the normal upstream path to central.
const TOPIC_SCAN        = `projects/${SITE}/_config/scan-nvr`;
const TOPIC_SCAN_RESULT = `projects/${SITE}/_config/scan-result`;
// Model detect (OPT5-EDGE-004): central publishes a request here on camera Save
// (self-contained connection params, same shape as scan-nvr — no _cameraMap
// lookup, so a brand-new/just-edited camera can't lose a race against the
// separate _config/cameras config-apply). Reply on _config/detect-model-result.
const TOPIC_DETECT        = `projects/${SITE}/_config/detect-model`;
const TOPIC_DETECT_RESULT = `projects/${SITE}/_config/detect-model-result`;
// Delete-media (OPT5-EDGE-005): central publishes here after a camera delete
// (keepData=false). Reply on _config/delete-media-result for audit visibility.
const TOPIC_DELETE_MEDIA        = `projects/${SITE}/_config/delete-media`;
const TOPIC_DELETE_MEDIA_RESULT = `projects/${SITE}/_config/delete-media-result`;
const _CHANNEL_TITLE_URI = '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle';

// SEC5-HIGH-003 mitigation (partial): local NanoMQ allows anonymous publish, so
// anyone on the camera LAN can reach TOPIC_DETECT/TOPIC_DELETE_MEDIA. Reusing
// CAMERA_SECRET_KEY (already shared identically Central+every Edge) as a plain
// shared-secret check — not full NanoMQ auth, just gates these two admin/
// destructive command channels specifically. Constant-time compare.
function hasValidCommandSecret(req) {
  const expected = process.env.CAMERA_SECRET_KEY;
  const got = req && req.secret;
  if (!expected || !got || typeof got !== 'string') return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const client = mqtt.connect(process.env.EDGE_MQTT_BROKER || 'mqtt://localhost:1883', {
  clientId: `edge-config-${SITE}-${process.pid}`,
  clean: true,
  reconnectPeriod: 5000,
});

client.on('connect', () => {
  console.log(`[edge-config] connected — subscribing config + detection topics`);
  client.subscribe([TOPIC_IN, TOPIC_SCAN, TOPIC_DETECT, TOPIC_DELETE_MEDIA, '+/onvif-ej/RuleEngine/#'], { qos: 1 }, (err) => {
    if (err) console.error('[edge-config] subscribe failed:', err.message);
  });
});

// Throttle: one snapshot per camera per N ms to avoid flooding on rapid events
const _snapCooldown = new Map();
const SNAP_COOLDOWN_MS = parseInt(process.env.SNAP_COOLDOWN_MS || '3000', 10);
// Last captured snapshot file per camera — re-used for burst events within cooldown
const _lastSnapFile = new Map();

// Self-heal: if a detection arrives for a camera not in _cameraMap (config drift —
// process missed a rebuild), reload cameras-config.json from disk. Throttled per
// camera so a genuinely-unknown camera doesn't spam disk reads / logs.
const _unknownCam = new Map();
const UNKNOWN_RELOAD_MS = 30_000;

client.on('message', (topic, buf, packet) => {
  // Config push from central (allow retained — bridge publishes with retain:true so
  // the current config reloads automatically when edge-config-agent restarts)
  if (topic === TOPIC_IN) {
    try {
      const payload = JSON.parse(buf.toString());
      if (!Array.isArray(payload.cameras)) throw new Error('payload.cameras is not an array');

      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ cameras: payload.cameras }, null, 2));
      fs.chmodSync(CONFIG_PATH, 0o600); // SEC5-HIGH-001: contains camera credentials
      _cameraMap = {};
      for (const c of payload.cameras) {
        if (c.camera_id) _cameraMap[c.camera_id] = decryptCamCreds(c);
      }

      client.publish(TOPIC_ACK, JSON.stringify({
        version: payload.version,
        applied_at: new Date().toISOString(),
        ok: true,
      }), { qos: 1 });

      console.log(`[edge-config] applied v${payload.version} — ${payload.cameras.length} cameras`);
    } catch (e) {
      console.error('[edge-config] apply failed:', e.message);
      client.publish(TOPIC_ACK, JSON.stringify({ ok: false, error: e.message }), { qos: 1 });
    }
    return;
  }

  // NVR channel scan request (Phase 3) — enumerate the NVR over the LAN and
  // reply. The NVR is on this edge's LAN, so we (not central) can reach it.
  if (topic === TOPIC_SCAN) {
    let scanId = null;
    try {
      const req = JSON.parse(buf.toString());
      scanId = req.scan_id || null;
      _fetchJpeg(req.ip_address, req.http_port || 80, _CHANNEL_TITLE_URI,
        req.username || '', req.password || '', (err, body) => {
          if (err) {
            client.publish(TOPIC_SCAN_RESULT, JSON.stringify({ scan_id: scanId, error: err.message }), { qos: 1 });
            console.warn(`[edge-scan] ${req.ip_address}: ${err.message}`);
            return;
          }
          const channels = parseChannelTitles(body.toString('utf8'));
          client.publish(TOPIC_SCAN_RESULT, JSON.stringify({ scan_id: scanId, channels }), { qos: 1 });
          console.log(`[edge-scan] ${req.ip_address} → ${channels.length} channels`);
        });
    } catch (e) {
      client.publish(TOPIC_SCAN_RESULT, JSON.stringify({ scan_id: scanId, error: e.message }), { qos: 1 });
    }
    return;
  }

  // Model detect request (OPT5-EDGE-004) — fired by central on camera Save.
  // Connection params come in the request itself (not looked up from
  // _cameraMap), so this can't race the separate _config/cameras config-apply
  // for a brand-new or just-edited camera.
  if (topic === TOPIC_DETECT) {
    let cameraId = null;
    (async () => {
      try {
        const req = JSON.parse(buf.toString());
        cameraId = req.camera_id || null;
        if (!hasValidCommandSecret(req)) {
          console.warn(`[edge-detect] ${cameraId}: rejected — missing/invalid command secret`);
          return;
        }
        const cam = { ip_address: req.ip_address, username: req.username, vendor: req.vendor };
        const info = await detectModel(cam, req.password || '');
        if (info && info.model) {
          client.publish(TOPIC_DETECT_RESULT, JSON.stringify({
            camera_id: cameraId, model: info.model, firmware: info.firmware, serial: info.serial,
          }), { qos: 1 });
          console.log(`[edge-detect] ${cameraId} (${req.ip_address}) → ${info.model}`);
        } else {
          client.publish(TOPIC_DETECT_RESULT, JSON.stringify({
            camera_id: cameraId, error: 'unreachable, auth failed, or model not recognized',
          }), { qos: 1 });
          console.warn(`[edge-detect] ${cameraId} (${req.ip_address}): no model detected`);
        }
      } catch (e) {
        client.publish(TOPIC_DETECT_RESULT, JSON.stringify({ camera_id: cameraId, error: e.message }), { qos: 1 });
      }
    })();
    return;
  }

  // Delete-media request (OPT5-EDGE-005) — remove a deleted camera's on-disk
  // media from this edge's local snapshot tree. deleteCameraMedia() carries
  // its own reject-then-use validation (rejects '..'/'.'/empty/malformed
  // camera_id outright rather than sanitizing) and exact dir-name matching.
  if (topic === TOPIC_DELETE_MEDIA) {
    let cameraId = null;
    (async () => {
      try {
        const req = JSON.parse(buf.toString());
        cameraId = req.camera_id || null;
        if (!hasValidCommandSecret(req)) {
          console.warn(`[edge-delete-media] ${cameraId}: rejected — missing/invalid command secret`);
          return;
        }
        const r = await deleteCameraMedia(SNAPSHOT_DIR, cameraId);
        if (r.rejected) {
          client.publish(TOPIC_DELETE_MEDIA_RESULT, JSON.stringify({
            camera_id: cameraId, error: 'camera_id rejected (invalid or unsafe)',
          }), { qos: 1 });
          console.warn(`[edge-delete-media] ${cameraId}: rejected`);
        } else {
          client.publish(TOPIC_DELETE_MEDIA_RESULT, JSON.stringify({
            camera_id: cameraId, dirs_removed: r.dirsRemoved,
          }), { qos: 1 });
          console.log(`[edge-delete-media] ${cameraId} → removed ${r.dirsRemoved} date-dir(s)`);
        }
      } catch (e) {
        client.publish(TOPIC_DELETE_MEDIA_RESULT, JSON.stringify({ camera_id: cameraId, error: e.message }), { qos: 1 });
      }
    })();
    return;
  }

  // Detection events: skip broker-replayed stale retained messages on reconnect
  // (Bosch publishes with retain=true; on restart we'd re-fire HTTP captures for
  //  old events whose DB rows may already have _snapshot_full set → silent no-match).
  //
  // NOTE: stateful detectors (FieldDetector/ObjectsInside occupancy, CountAggregation)
  // are also published retained, so this skips their *live* snapshots too. We tried a
  // UtcTime-freshness exception to let live retained events through, but it's fragile —
  // it compares edge Date.now() to the camera's UtcTime, so any camera↔edge clock skew
  // (the 3100i ran ~3.5h behind, NTP unset) makes every live event look "stale" and get
  // skipped anyway. The robust fix lives at the camera: configure occupancy rules that
  // need a snapshot as a *momentary* trigger (LineDetector/Crossed / "object enters
  // field") — those are non-retained and never hit this guard. See GOTCHAS #103.
  if (packet && packet.retain) return;

  // Detection event → capture HTTP snapshot and forward to central.
  // CountAggregation excluded: it's a people-COUNT state (feeds occupancy stats via
  // msg.Data.Count, not snapshots), the Events list filters it out, and it fires far
  // too often — capturing for it wasted disk on frames nothing displays (2026-06-29).
  if (!['ObjectDetection', 'LineDetector', 'FieldDetector'].some(t => topic.includes(t))) return;

  const cameraId = topic.split('/')[0];
  let cam        = _cameraMap[cameraId];
  if (!cam || !cam.ip_address) {
    // Config drift: detection for a camera not in the in-memory map. Reload from
    // disk (throttled per camera) so newly-added cameras work without a restart.
    const t = Date.now();
    if (t - (_unknownCam.get(cameraId) || 0) < UNKNOWN_RELOAD_MS) return;
    _unknownCam.set(cameraId, t);
    const before = Object.keys(_cameraMap).length;
    _cameraMap = _loadCameraMap();
    cam = _cameraMap[cameraId];
    if (cam && cam.ip_address) {
      console.log(`[edge-snap] ${cameraId}: not in map → reloaded cameras-config (${before}→${Object.keys(_cameraMap).length} cams) → recovered`);
    } else {
      console.warn(`[edge-snap] ${cameraId}: detection event but NOT in cameras-config (no snapshot). Reloaded disk (${before}→${Object.keys(_cameraMap).length} cams), still missing — check central config / camera_id match.`);
      return;
    }
  }

  // Throttle: burst events within SNAP_COOLDOWN_MS reuse the last captured file
  const now = Date.now();
  if (_snapCooldown.has(cameraId) && now - _snapCooldown.get(cameraId) < SNAP_COOLDOWN_MS) {
    const lastFile = _lastSnapFile.get(cameraId);
    if (lastFile) {
      let utcBurst;
      try { utcBurst = JSON.parse(buf.toString()).UtcTime; } catch { /* ignore */ }
      client.publish(`${cameraId}/onvif-ej/Device/snapshot`,
        JSON.stringify({ ts: utcBurst || new Date().toISOString(), snapshot_file: lastFile }), { qos: 0 });
    }
    return;
  }
  _snapCooldown.set(cameraId, now);

  let utcTime;
  try { utcTime = JSON.parse(buf.toString()).UtcTime; } catch { /* ignore */ }
  if (!utcTime) utcTime = new Date().toISOString();

  captureAndPublish(cameraId, cam, utcTime);
});

function captureAndPublish(cameraId, cam, utcTime) {
  const topic   = `${cameraId}/onvif-ej/Device/snapshot`;
  const snapUrl = `http://${cam.ip_address}/snap.jpg?JpegSize=1920x1080`;
  const options = { timeout: 5000, headers: {} };
  if (cam.username && cam.password) {
    options.headers['Authorization'] =
      'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
  }

  const req = http.get(snapUrl, options, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      console.warn(`[edge-snap] ${cameraId} HTTP ${res.statusCode}`);
      return;
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const buf  = Buffer.concat(chunks);
      const tsMs = Date.now();
      const { dir, relBase } = snapPath(SNAPSHOT_DIR, 'events', cameraId, tsMs);
      const fname = `event_edge_${tsMs}.jpg`;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fname), buf);
      } catch (e) { console.warn(`[edge-snap] ${cameraId} write fail: ${e.message}`); return; }
      const snapshot_file = `${relBase}/${fname}`;
      _lastSnapFile.set(cameraId, snapshot_file);
      client.publish(topic, JSON.stringify({ ts: utcTime, snapshot_file }), { qos: 0 });
      console.log(`[edge-snap] ${cameraId} → ${(buf.length / 1024).toFixed(0)}KB @ ${snapshot_file}`);
    });
  });
  req.on('error',   (e) => console.warn(`[edge-snap] ${cameraId} error: ${e.message}`));
  req.on('timeout', ()  => { req.destroy(); console.warn(`[edge-snap] ${cameraId} timeout`); });
}

client.on('error',    (e) => console.error('[edge-config] MQTT error:', e.message || e.code));
client.on('reconnect', () => console.log('[edge-config] reconnecting…'));

// Keepalive heartbeat every 60s — central touchCamera to prevent false-offline.
// TCP probe gates each publish: offline cameras are silently skipped, central
// marks them offline after OFFLINE_THRESHOLD_SEC (90s). Probes run in parallel.
// ponytail: warns every 60s per down camera — add transition-state dedup if log noise matters
setInterval(() => {
  if (!client.connected) return;
  for (const id of Object.keys(_cameraMap)) {
    const cam = _cameraMap[id];
    if (!cam || !cam.ip_address) continue;
    const sock = net.createConnection({ host: cam.ip_address, port: cam.http_port || 80, timeout: 3000 });
    sock.once('connect', () => {
      sock.destroy();
      client.publish(`${id}/onvif-ej/Device/heartbeat`,
        JSON.stringify({ UtcTime: new Date().toISOString() }), { qos: 0 });
    });
    sock.once('timeout', () => { sock.destroy(); console.warn(`[edge-hb] ${id} unreachable (timeout) — heartbeat suppressed`); });
    sock.once('error',   () => { console.warn(`[edge-hb] ${id} unreachable — heartbeat suppressed`); });
  }
}, 60_000);

// SD/recording status (Bosch ONVIF GetRecordingSummary) — central can't reach edge-site
// cameras directly, but we're on their LAN, so we probe locally and push the result
// up via MQTT (mqtt-subscriber.js applySdStatusResult). Hourly: recording status doesn't
// need heartbeat-rate freshness, and this is a full ONVIF SOAP round-trip per camera.
function buildOnvifSecurityHeader(username, password) {
  const nonceBuf = crypto.randomBytes(16);
  const nonceB64 = nonceBuf.toString('base64');
  const created = new Date().toISOString().replace(/\.\d+Z$/, '.000Z');
  const digestBuf = crypto.createHash('sha1')
    .update(Buffer.concat([nonceBuf, Buffer.from(created, 'utf8'), Buffer.from(password, 'utf8')]))
    .digest();
  const digestB64 = digestBuf.toString('base64');
  return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${username}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digestB64}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}

function onvifGetRecordingSummary(cam) {
  return new Promise((resolve) => {
    if (!cam.ip_address) return resolve({ ok: false, error: 'no ip' });
    const security = buildOnvifSecurityHeader(cam.username || '', cam.password || '');
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trc="http://www.onvif.org/ver10/search/wsdl"><s:Header>${security}</s:Header><s:Body><trc:GetRecordingSummary/></s:Body></s:Envelope>`;
    const req = http.request({
      method: 'POST', hostname: cam.ip_address, port: cam.http_port || 80,
      path: '/onvif/search_service',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const xml = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
        const dataFrom  = (xml.match(/<tt:DataFrom>([^<]+)<\/tt:DataFrom>/) || [])[1];
        const dataUntil = (xml.match(/<tt:DataUntil>([^<]+)<\/tt:DataUntil>/) || [])[1];
        const numRec = parseInt((xml.match(/<tt:NumberRecordings>(\d+)<\/tt:NumberRecordings>/) || [])[1] || '0', 10);
        if (!dataUntil) {
          const fault = (xml.match(/<SOAP-ENV:Text[^>]*>([^<]+)/) || [])[1];
          return resolve({ ok: false, error: fault || 'no DataUntil' });
        }
        resolve({ ok: true, dataFrom, dataUntil, numRec });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// OPT5-EDGE-002 — this used to fire onvifGetRecordingSummary (8s timeout each)
// for every Bosch camera in one synchronous loop, all at once. capturePreview
// already solved the same problem by staggering across its poll interval; cap
// the spread here at 30s instead of the full hour so probes still finish well
// before the next cycle (an hourly startup dribble isn't worth the anti-burst
// benefit at this cadence — see advisor review, 2026-07-22).
const SD_POLL_STAGGER_MS = 30_000;
function pollSdStatusOnce() {
  if (!client.connected) return;
  const ids = Object.keys(_cameraMap).filter(id => {
    const cam = _cameraMap[id];
    return cam && cam.ip_address && String(cam.vendor || '').toLowerCase() === 'bosch';
  });
  const gap = ids.length > 1 ? Math.floor(SD_POLL_STAGGER_MS / ids.length) : 0;
  ids.forEach((id, i) => {
    setTimeout(() => {
      const cam = _cameraMap[id];
      if (!cam) return;
      onvifGetRecordingSummary(cam).then((r) => {
        client.publish(`${id}/onvif-ej/Device/sd-status`, JSON.stringify(r), { qos: 0 });
      });
    }, gap * i);
  });
}
const SD_POLL_INTERVAL_MS = parseInt(process.env.SD_POLL_INTERVAL_MS || '3600000', 10); // 1h
setTimeout(pollSdStatusOnce, 10_000);
setInterval(pollSdStatusOnce, SD_POLL_INTERVAL_MS);

// Pilot (2026-07-19) — Dahua LPR cameras at HDY have no storage of their own (confirmed
// live: storageDevice.cgi 400s on a standalone LPR cam); they're recorded by one of 4
// physical NVRs instead, which aren't modeled as separate rows for these LPR camera_ids.
// Probe each NVR once (reusing its existing camera_id entry's ip/creds) and fan the
// result out to every camera_id it actually backs, over the SAME sd-status topic/columns
// as Bosch — sd_status/sd_error/sd_last_check_at only (mqtt-subscriber.js coalesces the
// ONVIF-only dataFrom/dataUntil/numRec fields to null since this isn't ONVIF). No-op on
// any edge node that doesn't have these camera_ids locally (e.g. VSS).
const DAHUA_NVR_PILOT = {
  'HDY-NVR-01-ch0': ['HDY-NVR-01-ch0', 'HDY-NVR-01-ch1', 'hdy-anpr1', 'hdy-anpr-lotus2', 'hdy-motor-lotus1', 'hdy-motor-lotus2'],
  'HDY-NVR-02-ch0': ['HDY-NVR-02-ch0', 'HDY-NVR-02-ch1', 'hdy-motor-bigc1', 'hdy-motor-bigc2', 'hdy-anpr-bigc1', 'hdy-anpr-bigc2'],
  'HDY-NVR-03-ch0': ['HDY-NVR-03-ch0', 'HDY-NVR-03-ch1', 'hdy-anpr-r51', 'hdy-anpr-r52', 'hdy-motor-r51', 'hdy-motor-r52'],
  'HDY-NVR-04-ch0': ['HDY-NVR-04-ch0', 'HDY-NVR-04-ch1', 'hdy-anpr-1081', 'hdy-anpr-1082', 'hdy-motor-1081', 'hdy-motor-1082'],
};

// list.info[N].State / .Detail[M].IsError — classic Dahua key=value text, not JSON.
// UsedBytes≈TotalBytes is normal ring-buffer overwrite, not a fault — ignore capacity,
// judge health from State/IsError only (confirmed live against HDY-NVR-01, 2026-07-19).
function dahuaStorageHealthy(text) {
  const states = [...text.matchAll(/\.State=([^\r\n]+)/g)].map(m => m[1].trim());
  const errors = [...text.matchAll(/\.IsError=(true|false)/g)].map(m => m[1] === 'true');
  if (!states.length) return { ok: false, error: 'no storage device reported' };
  if (errors.some(Boolean)) return { ok: false, error: 'storage IsError=true' };
  if (states.some((s) => s !== 'Success')) return { ok: false, error: `storage state: ${states.join(',')}` };
  return { ok: true };
}

function dahuaGetDeviceStorage(cam) {
  return new Promise((resolve) => {
    if (!cam.ip_address) return resolve({ ok: false, error: 'no ip' });
    const uriPath = '/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo';
    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const req = http.request({
        hostname: cam.ip_address, port: cam.http_port || 80, path: uriPath, method: 'GET',
        headers, timeout: 8000,
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          if (res.statusCode === 401 && !authHeader) {
            const wa = res.headers['www-authenticate'] || '';
            return attempt(buildDigestHeader(cam.username || '', cam.password || '', 'GET', uriPath, parseChallenge(wa)));
          }
          if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          resolve(dahuaStorageHealthy(data));
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.end();
    };
    attempt(null);
  });
}

function pollDahuaNvrStorageOnce() {
  if (!client.connected) return;
  for (const [nvrRefId, targets] of Object.entries(DAHUA_NVR_PILOT)) {
    const cam = _cameraMap[nvrRefId];
    if (!cam || !cam.ip_address) continue; // this edge's site doesn't have this NVR
    dahuaGetDeviceStorage(cam).then((r) => {
      for (const targetId of targets) {
        client.publish(`${targetId}/onvif-ej/Device/sd-status`, JSON.stringify(r), { qos: 0 });
      }
    });
  }
}
setTimeout(pollDahuaNvrStorageOnce, 15_000);
setInterval(pollDahuaNvrStorageOnce, SD_POLL_INTERVAL_MS);

// Vendor-aware JPEG fetch with Digest/Basic auth fallback (shared by preview loop
// + NVR channel scan). Timeout 45s (was 8s) — live-measured: a loaded 16-channel
// NVR (DHI-NVR5216-16P-I/L, Intelligent Algorithm running on several channels)
// took 37.5s for a full digest-auth ChannelTitle fetch (2026-07-16). Response
// speed varies a lot device-to-device (some answer in ms) — a longer timeout
// only affects the slow ones since we resolve as soon as a response lands.
const _FETCH_JPEG_TIMEOUT_MS = 45000;
function _fetchJpeg(host, port, uri, user, pass, cb) {
  const attempt = (authHeader) => {
    // Guard against double-invoking cb: req.destroy() on timeout can also fire
    // a subsequent 'error' event (e.g. "socket hang up") — without this, that
    // second call would overwrite the clearer "timeout" error already reported.
    let settled = false;
    const finish = (err, buf) => { if (!settled) { settled = true; cb(err, buf); } };
    const headers = {};
    if (authHeader) headers.Authorization = authHeader;
    const req = http.get({ host, port: port || 80, path: uri, headers, timeout: _FETCH_JPEG_TIMEOUT_MS }, (res) => {
      if (res.statusCode === 401 && !authHeader) {
        const wa = res.headers['www-authenticate'] || '';
        res.resume();
        // Retry with a fresh attempt() (its own settled/finish) — do NOT call
        // finish() here, this attempt isn't done, it's handing off to the next one.
        if (/digest/i.test(wa)) { settled = true; return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa))); }
        if (/basic/i.test(wa))  { settled = true; return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')); }
        return finish(new Error('401 no supported auth'));
      }
      if (res.statusCode !== 200) { res.resume(); return finish(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => finish(null, Buffer.concat(chunks)));
      res.on('error', finish);
    });
    req.on('error', finish);
    req.on('timeout', () => { req.destroy(); finish(new Error('timeout')); });
  };
  attempt(null);
}

// True when >1 configured camera shares this IP — i.e. a multi-channel recorder
// (NVR), not a standalone camera. Standalone cams (even ones tagged nvr_channel,
// e.g. a direct ANPR) own their IP and snapshot.cgi works on them.
function _sharesIp(ip) {
  if (!ip) return false;
  let n = 0;
  for (const id in _cameraMap) {
    if (_cameraMap[id] && _cameraMap[id].ip_address === ip && ++n > 1) return true;
  }
  return false;
}

// Periodic full-scene tile preview — vendor-aware, writes to stable path
// snapshots/preview/{cameraId}.jpg (overwritten in place, out of retention tree).
function capturePreview(cameraId, cam) {
  const vendor = String(cam.vendor || '').toLowerCase();
  // Dahua NVR sub-channels: snapshot.cgi returns HTTP 500 on the recorder for remote
  // channels (verified live — every channel/subtype 500s on these NVRs). We detect the
  // NVR case by shared IP (sibling channels on one recorder), NOT nvr_channel alone —
  // a standalone ANPR tagged nvr_channel=0 still serves snapshot.cgi fine (200).
  // serveLatestSnapshot already serves the per-channel event scene (snapManager JPEG)
  // for NVR channels, so the tile fetch never succeeds and never gets used — pure
  // 500-spam + needless NVR load every interval. Skip it.
  // ponytail: shared-IP heuristic — no ffmpeg on edge, event scene is the only still
  if (vendor === 'dahua' && Number.isInteger(cam.nvr_channel) && _sharesIp(cam.ip_address)) return;
  // NVR channel is 0-based; Dahua CGI channel= is 1-based (matches dahua-cgi.js
  // snapshot path). A plain single-channel camera has no nvr_channel → channel 1.
  const dahuaCh = Number.isInteger(cam.nvr_channel) ? cam.nvr_channel + 1 : 1;
  const uri = vendor === 'hikvision'
    ? '/ISAPI/Streaming/channels/102/picture'
    : vendor === 'dahua'
      ? (cam.snapshot_path || `/cgi-bin/snapshot.cgi?channel=${dahuaCh}&subtype=1`)
      : (cam.snapshot_path || '/snap.jpg?JpegSize=1920x1080');

  _fetchJpeg(cam.ip_address, cam.http_port || 80, uri, cam.username || '', cam.password || '', (err, buf) => {
    if (err) { console.warn(`[edge-preview] ${cameraId} ${err.message}`); return; }
    const dir  = path.join(SNAPSHOT_DIR, 'preview');
    const dest = path.join(dir, `${cameraId}.jpg`);
    const tmp  = path.join(dir, `.${cameraId}.tmp`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
    } catch (e) { console.warn(`[edge-preview] ${cameraId} write fail: ${e.message}`); return; }
    const snapshot_file = `preview/${cameraId}.jpg`;
    client.publish(`${cameraId}/onvif-ej/Device/preview`,
      JSON.stringify({ ts: new Date().toISOString(), snapshot_file }), { qos: 0 });
    console.log(`[edge-preview] ${cameraId} ${vendor} → ${(buf.length / 1024).toFixed(0)}KB`);
  });
}

const PREVIEW_INTERVAL_MS = parseInt(process.env.PREVIEW_INTERVAL_MS || '120000', 10);
setInterval(() => {
  if (!client.connected) return;
  const ids = Object.keys(_cameraMap);
  const gap = ids.length > 1 ? Math.floor(PREVIEW_INTERVAL_MS / ids.length) : 0;
  ids.forEach((id, i) => {
    setTimeout(() => {
      const cam = _cameraMap[id];
      if (!cam || !cam.ip_address) return;
      capturePreview(id, cam);
    }, gap * i);
  });
}, PREVIEW_INTERVAL_MS);
