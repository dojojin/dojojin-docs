// ============================================================
// Vigil Platform — LPR / Face Push Receiver (standalone process)
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ------------------------------------------------------------
// CS7 — an INDEPENDENT, always-up process hosting the public push receivers
// (/lpr ANPR, /face-push/:token) that previously rode on api-server. Why split:
// restarting / redeploying api-server (the big dashboard process) currently
// drops the push endpoints, and our /lpr forward is a government system's only
// feed (see lpr-forward.js). This process has no UI, no WS, no auth surface —
// just the two receivers — so it stays up across dashboard work.
//
// It REUSES routes/lpr.js + routes/face-push.js verbatim (same modules
// api-server mounts) — no logic is duplicated. Cross-process pg_notify reaches
// the api-server ws-bridge LISTENer, so the dashboard still updates live.
//
// Bind: 0.0.0.0 (LAN-accessible) so central api-server can proxy-fetch /snapshots
// from this node via SNAPSHOT_PROXY_URL. Public ingress for /lpr + /face-push
// remains the Cloudflare tunnel; override via LPR_BIND_HOST env if needed.
//
// DEPLOY (deferred, user-run): add the PM2 entry (already in ecosystem.config.js),
// start via the LAN-safe Terminal path (GOTCHAS #84 — never from a Claude/ssh
// shell), then flip the cloudflared ingress (^/lpr$ + ^/face-push → :3003).
// Until that flip, api-server still serves both paths (rollback = flip back).
// ============================================================
'use strict';
process.env.APP_NAME = 'lpr-receiver'; // spool dir isolation (procTag fix)

const express = require('express');
const { Pool } = require('pg');
const env = require('./config');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { decryptCamCreds } = require('./crypto-creds');
const { parseChallenge, buildDigestHeader, probeAuth, AUTH_CHECK_PATH } = require('./helpers/digestAuth');
const { buildSdDetail } = require('./helpers/hikStorage');
const { retargetHttpHost, parseSlots: _parseSlots, sliceSlot: _sliceSlot } = require('./helpers/httpHostXml');
const { buildOnvifSecurityHeader } = require('./helpers/onvifSecurity');
const { hcpTime } = require('./helpers/hcpTime');
const { planHcpSearch } = require('./helpers/hcpSearchPlan');
require('dotenv').config({ quiet: true });
require('./singleton')('lpr-receiver');   // refuse to run a second copy

const PORT = env.int('LPR_RECEIVER_PORT');
const { snapshotDir } = require('./helpers/snapshotDir');
const SNAPSHOT_DIR = snapshotDir();
const CONFIG_FILE  = path.join(__dirname, '..', 'cameras-config.json');
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

const pool =   // 🔴 ไม่มี statement_timeout = query ค้างได้ไม่จำกัด · เจอจริง 2026-08-27:
  // query หนึ่งค้าง 34 ชั่วโมง ทำให้ autovacuum เก็บ dead tuple ไม่ได้ ตาราง events
  // บวมจนทั้งระบบช้า และหน้าสถิติว่างเปล่า · มีแค่ api-server ที่ตั้งค่านี้ไว้
  // รับ ANPR แล้ว insert — เส้นทางร้อนเช่นกัน
new Pool({
  options: '-c statement_timeout=60000',
  ...env.db(),
  max: 5,
  application_name: 'lpr-receiver',
});
// Match api-server: every session UTC (date-boundary correctness).
pool.on('connect', async (client) => {
  try { await client.query("SET TIME ZONE 'UTC'"); } catch { /* ignore */ }
});

// Own mtime-cached config loader (advisor #5) — re-reads on file change so
// Web-UI camera edits (saved by api-server) reach this process. Same shape as
// api-server.js / mqtt-subscriber.js (config is the camera source of truth).
let _cfgCache = null, _cfgMtime = 0;
function loadCameraConfig() {
  try {
    const mtime = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : 0;
    if (mtime !== _cfgMtime) {
      const raw = mtime ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : { cameras: [] };
      if (raw.cameras) raw.cameras = raw.cameras.map(decryptCamCreds);
      _cfgCache = raw;
      _cfgMtime = mtime;
    }
    return _cfgCache || { cameras: [] };
  } catch (e) { console.error('[lpr-receiver] config load error:', e.message); return { cameras: [] }; }
}

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

// Liveness probe (used by the deploy verify + any future monitor).
// unknown_push_tokens: ยอด push token ไม่รู้จักรอบ 10 นาทีล่าสุด — หน้า Health ของ Central อ่านจากที่นี่
// เพราะ /face-push ที่ token ค้างวิ่งเข้าโปรเซสนี้ ไม่ใช่ api-server (GOTCHAS #220) · เป็นแค่ตัวเลข ไม่มี token
app.get('/healthz', (req, res) => res.json({ ok: true, app: 'lpr-receiver', port: PORT,
  unknown_push_tokens: require('./helpers/unknownTokenLog').lastWindows() }));

// POST /test-connection — TCP reachability + HTTP auth check proxied from central.
// Central cannot reach LAN cameras directly; edge can. Same response shape as the
// central /api/cameras/test-connection route. Protected by proxy secret.
const net = require('net');
app.post('/test-connection', express.json(), (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const { ip_address, http_port, vendor, username, password } = req.body || {};
  const ip = String(ip_address || '').trim();
  if (!ip) return res.status(400).json({ error: 'ip_address required' });

  const port  = parseInt(http_port, 10) || 80;
  const v     = String(vendor || 'bosch').toLowerCase();
  const start = Date.now();

  const sock = new net.Socket();
  sock.setTimeout(3000);
  sock.once('connect', () => {
    sock.destroy();
    const latency_ms = Date.now() - start;

    if (AUTH_CHECK_PATH[v] && username && password) {
      probeAuth(ip, port, AUTH_CHECK_PATH[v], username, password)
        .then((auth_status) => res.json({ reachable: true, auth_status, latency_ms, via_edge: true }));
    } else {
      res.json({ reachable: true, auth_status: 'unknown', latency_ms, via_edge: true });
    }
  });
  sock.once('error', () => res.json({ reachable: false, auth_status: 'unknown', latency_ms: Date.now() - start, via_edge: true }));
  sock.once('timeout', () => { sock.destroy(); res.json({ reachable: false, auth_status: 'unknown', latency_ms: Date.now() - start, via_edge: true }); });
  sock.connect(port, ip);
});

// POST /probe-camera-snapshot — เจ้าของสั่ง 2026-09-15: ก่อนประกาศกล้อง "กลับมา
// ออนไลน์" ให้ยิงไปขอ snapshot จริงจากกล้อง ไม่ใช่เชื่อ heartbeat อย่างเดียว
// (heartbeat แค่บอกว่ามีแพ็กเก็ตหลุดมาถึง ไม่ได้ยืนยันว่ากล้องใช้งานได้จริง —
// ดูปมจริงที่ api-server.js:_confirmCameraViaSnapshot) central ต่อ IP กล้อง
// ที่ site ไม่ได้เลย (ทดสอบแล้ว ping/curl timeout ทั้งคู่ ไม่มี route ไปวง LAN
// ของไซต์) จึงต้องยิงจากตรงนี้ (edge อยู่ LAN เดียวกับกล้อง) แล้วตอบกลับ
// central ผ่าน edgeCall() — เรียกน้อยครั้ง (central กัน lockout ด้วย cooldown/
// backoff ของมันเองแล้ว จุดนี้แค่ตอบตามจริงว่ามีภาพจริงไหม ไม่ต้องกันซ้ำเอง)
const SNAPSHOT_PROBE_CANDIDATES = {
  dahua: ['/cgi-bin/snapshot.cgi?channel=1', '/cgi-bin/snapshot.cgi?channel=0', '/cgi-bin/snapshot.cgi'],
  onvif: ['/ISAPI/Streaming/channels/101/picture', '/onvif/snapshot', '/snapshot.jpg', '/cgi-bin/snapshot.cgi?channel=1'],
  // 🔴 Bosch เคยตกไปใช้ชุด onvif ซึ่งกล้องตอบ http_400 ทุกเส้น ⇒ ไม่เคยยืนยันได้ กล้อง Bosch ทั้ง 8 ตัว
  // ติด enabled=false ถาวรตั้งแต่ 15 ก.ย. (GOTCHAS #217) · /snap.jpg = path เดียวกับ edge-config-agent
  // (captureAndPublish) ที่ดึงภาพ Bosch ได้จริงทุก 2–3 นาที
  bosch: ['/snap.jpg'],
  // ระบุตรง ๆ (เดิมตกไปชุด onvif ซึ่งขึ้นต้นด้วย ISAPI อยู่แล้ว — ลำดับเท่าเดิม พฤติกรรมไม่เปลี่ยน)
  // เพื่อให้ตัวตรวจตอนบูตข้างล่างถือว่า "ทุกยี่ห้อที่ใช้อยู่มี path ของตัวเอง"
  hikvision: ['/ISAPI/Streaming/channels/101/picture', '/onvif/snapshot', '/snapshot.jpg', '/cgi-bin/snapshot.cgi?channel=1'],
};

// ตอนบูต: กล้องยี่ห้อที่ไม่มี path ของตัวเอง = จะตกไปชุด onvif ซึ่งอาจไม่ตรงกับกล้องจริง
// (เคส Bosch: http_400 ทุกเส้น ติด offline 2 สัปดาห์โดยไม่มีใครเห็น · GOTCHAS #217) → เตือนให้เห็นใน log
function warnVendorsWithoutProbePath() {
  try {
    const miss = {};
    for (const c of loadCameraConfig().cameras || []) {
      const v = String(c.vendor || 'onvif').toLowerCase();
      if (!SNAPSHOT_PROBE_CANDIDATES[v] && !c.snapshot_path) (miss[v] = miss[v] || []).push(c.camera_id);
    }
    for (const [v, ids] of Object.entries(miss)) {
      if (v === 'onvif') continue;
      console.warn(`[lpr-receiver] ยี่ห้อ "${v}" ไม่มี path ยืนยันภาพของตัวเอง ${ids.length} กล้อง (เช่น ${ids.slice(0, 3).join(', ')}) — ใช้ชุด onvif แทน`);
    }
  } catch (e) { console.warn('[lpr-receiver] vendor probe check:', e.message); }
}

function _probeSnapshotFound(host, port, uri, user, pass) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get({ host, port, path: uri, headers, timeout: 4000 }, (pr) => {
        if (pr.statusCode === 401) {
          if (!authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          } else {
            pr.resume();
          }
          return finish({ found: false, reason: 'auth' });
        }
        if (pr.statusCode !== 200) { pr.resume(); return finish({ found: false, reason: `http_${pr.statusCode}` }); }
        const ct = String(pr.headers['content-type'] || '').toLowerCase();
        let head = Buffer.alloc(0);
        pr.on('data', (c) => {
          head = Buffer.concat([head, c]);
          if (head.length >= 2) {
            const isJpeg = head[0] === 0xFF && head[1] === 0xD8;
            pr.destroy();
            finish((ct.includes('image') || isJpeg) ? { found: true } : { found: false, reason: 'not_image' });
          }
        });
        pr.on('end', () => finish(ct.includes('image') ? { found: true } : { found: false, reason: 'not_image' }));
      });
      r.on('error', () => finish({ found: false, reason: 'unreachable' }));
      r.on('timeout', () => { r.destroy(); finish({ found: false, reason: 'unreachable' }); });
    };
    attempt(null);
  });
}

app.post('/probe-camera-snapshot', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const camera_id = String(req.body?.camera_id || '').trim();
  if (!camera_id) return res.status(400).json({ error: 'camera_id required' });

  const cam = (loadCameraConfig().cameras || []).find((c) => c.camera_id === camera_id);
  if (!cam) return res.status(404).json({ error: 'camera not found' });
  if (!cam.ip_address || !cam.username) return res.json({ found: false, reason: 'no_credentials' });

  const port = cam.http_port || 80;
  const vendor = String(cam.vendor || 'onvif').toLowerCase();
  const base = SNAPSHOT_PROBE_CANDIDATES[vendor] || SNAPSHOT_PROBE_CANDIDATES.onvif;
  const uris = cam.snapshot_path ? [cam.snapshot_path, ...base] : base;

  let lastReason = 'unreachable';
  for (const uri of uris) {
    const r = await _probeSnapshotFound(cam.ip_address, port, uri, cam.username, cam.password);
    if (r.found) return res.json({ found: true, path: uri });
    lastReason = r.reason;
    // auth ผิด = รหัสผิดหรือบัญชีล็อก ไม่ใช่ path ผิด — ลอง path อื่นต่อก็แค่ยิงซ้ำ
    // เปล่า ๆ ด้วยรหัสเดิม หยุดทันทีไม่ลองต่อ
    if (r.reason === 'auth') break;
  }
  res.json({ found: false, reason: lastReason });
});

// GET /alarm-server-status?camera_id=X — reads ISAPI httpHosts from a face/lpr
// camera and compares vs expected FACE_PUSH_HOST. Protected by proxy secret
// (same as /snapshots). Central api-server proxies this for the dashboard.
const FACE_PUSH_HOST_EDGE = env.str('FACE_PUSH_HOST');
const FACE_PUSH_PORT_EDGE = env.int('FACE_PUSH_PORT');
const LPR_PORT_EDGE       = env.int('LPR_RECEIVER_PORT');
// Silent otherwise: /event-broker-configure just 503s and the dashboard shows
// "?" as the expected address (page-camera-settings.js), which reads like a
// camera/network problem, not a missing env var (found onboarding rmutr-v, 2026-08-18).
if (!FACE_PUSH_HOST_EDGE) console.warn('[lpr-receiver] FACE_PUSH_HOST not set — Bosch Event Broker config and Hik face-push IP check will not work on this edge');

app.get('/alarm-server-status', (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const camera_id = String(req.query.camera_id || '').trim();
  if (!camera_id) return res.status(400).json({ error: 'camera_id required' });

  const cam = (loadCameraConfig().cameras || []).find(c => c.camera_id === camera_id);
  if (!cam) return res.status(404).json({ error: 'camera not found' });

  const port = cam.http_port || cam.port || 80;
  const uri  = '/ISAPI/Event/notification/httpHosts';

  function doRequest(authHeader) {
    const headers = { Accept: 'application/xml' };
    if (authHeader) headers.Authorization = authHeader;
    const req2 = http.request(
      { host: cam.ip_address, port, path: uri, method: 'GET', headers, timeout: 5000 },
      (r) => {
        if (r.statusCode === 401) {
          const wa = r.headers['www-authenticate'];
          r.resume();
          if (wa && /digest/i.test(wa))
            doRequest(buildDigestHeader(cam.username, cam.password, 'GET', uri, parseChallenge(wa)));
          else
            res.status(502).json({ error: 'camera auth failed' });
          return;
        }
        let xml = '';
        r.on('data', d => { xml += d; });
        r.on('end', () => {
          // Extract all httpHost slots: [{id, ip, port, url}]
          const slots = [];
          for (const m of xml.matchAll(/<HttpHostNotification[^>]*>([\s\S]*?)<\/HttpHostNotification>/g)) {
            const block = m[1];
            const id   = (block.match(/<id>(\d+)<\/id>/)          || [])[1] || '?';
            const ip   = (block.match(/<ipAddress>([^<]+)<\/ipAddress>/) || [])[1] || '';
            const p    = (block.match(/<portNo>(\d+)<\/portNo>/)   || [])[1] || '';
            const url  = (block.match(/<url>([^<]*)<\/url>/)       || [])[1] || '';
            slots.push({ id, ip, port: parseInt(p, 10) || 0, url });
          }
          const face = slots.find(s => s.port === FACE_PUSH_PORT_EDGE) || null;
          const lpr  = slots.find(s => s.port === LPR_PORT_EDGE && s.url !== '/') || null;
          res.json({
            slots,
            face: face
              ? { ok: face.ip === FACE_PUSH_HOST_EDGE, current_ip: face.ip, current_port: face.port, expected_ip: FACE_PUSH_HOST_EDGE }
              : { ok: false, current_ip: null, current_port: null, expected_ip: FACE_PUSH_HOST_EDGE },
            lpr: lpr
              ? { ok: true, current_ip: lpr.ip, current_port: lpr.port, current_url: lpr.url }
              : { ok: false, current_ip: null, current_port: null, current_url: null },
          });
        });
      }
    );
    req2.on('error', (e) => res.status(502).json({ error: e.message }));
    req2.end();
  }
  doRequest(null);
});

// ── httpHost backup / repoint / restore ─────────────────────────────────────
// Automates, as three endpoints, the exact manual procedure used to cut the
// first HKT ANPR camera over from "push straight to CIB" to "push to us, we
// relay": GET the current config → keep the bytes → PUT with ONLY the
// destination changed → GET back to prove what the device actually holds now.
//
// Every one of these moves a live government feed, so two rules are absolute:
//   1. The PUT is the FETCHED xml with three tags swapped — never a template.
//      The real config carries <ANPR><detectionUpLoadPicturesType> and
//      <SubscribeEvent><heartbeat>, which a hand-built body (e.g. the face
//      configureAlarmServer template) silently drops: plate images would stop
//      arriving with no error anywhere.
//   2. Every response reports the config re-read FROM THE CAMERA after the
//      write, not just the PUT status — "200 OK" is not evidence.
const _httpHostUri = (slot) => `/ISAPI/Event/notification/httpHosts${slot ? `/${slot}` : ''}`;

// One digest-authed request to a camera. Resolves { code, xml, localAddress }.
// localAddress is the edge IP the CAMERA's network actually routed us over —
// that, not a guessed env var, is the address the camera should push back to
// (and it stays correct if the edge later grows a second uplink).
function _camReq(cam, method, uri, body) {
  return new Promise((resolve, reject) => {
    const port = cam.http_port || cam.port || 80;
    let localAddress = null;
    const attempt = (authHeader) => {
      const headers = { Accept: 'application/xml' };
      if (body) { headers['Content-Type'] = 'application/xml'; headers['Content-Length'] = Buffer.byteLength(body); }
      if (authHeader) headers.Authorization = authHeader;
      const r = http.request({ host: cam.ip_address, port, path: uri, method, headers, timeout: 8000 }, (res) => {
        if (res.statusCode === 401 && !authHeader) {
          const wa = res.headers['www-authenticate'] || '';
          res.resume();
          if (/digest/i.test(wa)) return attempt(buildDigestHeader(cam.username, cam.password, method, uri, parseChallenge(wa)));
          return reject(new Error('camera auth failed'));
        }
        let xml = '';
        res.on('data', d => { xml += d; });
        res.on('end', () => resolve({ code: res.statusCode, xml, localAddress }));
      });
      r.on('socket', s => s.on('connect', () => { localAddress = s.localAddress; }));
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('camera timeout')); });
      if (body) r.write(body);
      r.end();
    };
    attempt(null);
  });
}

function _requireSecret(req, res) {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}
function _findCam(req, res, id) {
  const cam = (loadCameraConfig().cameras || []).find(c => c.camera_id === id);
  if (!cam) { res.status(404).json({ error: 'camera not found' }); return null; }
  return cam;
}

// A failure that happened AT THE CAMERA, reported as HTTP 200 + ok:false.
//
// Not cosmetic: these endpoints are reached from central through a Cloudflare
// tunnel, and Cloudflare replaces a 5xx from the origin with its own HTML error
// page. Answering 502 therefore destroyed the very field that explains the
// failure — central's JSON.parse blew up and the operator saw "internal server
// error" instead of the camera saying "Invalid XML Content". Status codes stay
// meaningful for problems on THIS side (401/404/400); anything the camera said
// travels as a 200 so the words survive the trip.
const _camFail = (res, error, camera_response) =>
  res.json({ ok: false, error, ...(camera_response ? { camera_response } : {}) });

// GET /sd-status?camera_id=X — what the camera's own microSD holds.
//
// Three ISAPI reads because no single one answers the question: Storage says a
// card is present and how full, record/tracks says whether recording is even
// scheduled and at what bitrate, and search says whether anything is actually
// there. All 34 Phuket cameras report a healthy card; none of them has ever
// recorded a frame. Reading only the first document is why nobody noticed.
//
// Lives on the edge because the camera credentials do. Read-only — nothing here
// writes to a camera, formats a card, or changes a schedule.
app.get('/sd-status', async (req, res) => {
  if (!_requireSecret(req, res)) return;
  const cam = _findCam(req, res, String(req.query.camera_id || '').trim());
  if (!cam) return;
  // search is the expensive one — the camera walks its own filesystem for it —
  // so it is skipped unless asked for. The periodic collector wants it; a UI
  // refresh usually does not.
  const wantSearch = req.query.search !== '0';
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  try {
    // Both documents, same reasoning as the hourly collector: ANPR cameras 403
    // ContentMgmt/Storage entirely and answer System/status instead, so a single
    // document leaves one whole class of camera with nothing.
    const status = await _camReq(cam, 'GET', '/ISAPI/System/status');
    const storage = await _camReq(cam, 'GET', '/ISAPI/ContentMgmt/Storage');
    if (storage.code !== 200 && status.code !== 200) {
      return _camFail(res, `camera HTTP ${storage.code}/${status.code}`, storage.xml);
    }
    // Unconditional, like the collector: ANPR cameras refuse every storage
    // document and still answer both of these.
    const tracks = await _camReq(cam, 'GET', '/ISAPI/ContentMgmt/record/tracks');
    const anr = await _camReq(cam, 'GET', '/ISAPI/Traffic/ANR');
    const hosts = await _camReq(cam, 'GET', '/ISAPI/Event/notification/httpHosts');

    let searchXml = null;
    if (wantSearch && storage.code === 200) {
      const now = new Date(), from = new Date(now - days * 86400000);
      const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
      // maxResults kept small on purpose: only the span and the total are used,
      // and asking a camera for thousands of match records to count them is a
      // slow way to read one number it already returns in totalMatches.
      const body = `<?xml version="1.0" encoding="utf-8"?>
<CMSearchDescription><searchID>VIGIL-SD-${Date.now()}</searchID>
<trackIDList><trackID>101</trackID></trackIDList>
<timeSpanList><timeSpan><startTime>${iso(from)}</startTime><endTime>${iso(now)}</endTime></timeSpan></timeSpanList>
<maxResults>40</maxResults><searchResultPostion>0</searchResultPostion>
<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>
</CMSearchDescription>`;
      const s = await _camReq(cam, 'POST', '/ISAPI/ContentMgmt/search', body);
      if (s.code === 200) searchXml = s.xml;
    }

    res.json({ ok: true, camera_id: cam.camera_id,
      detail: buildSdDetail({ storageXml: storage.code === 200 ? storage.xml : null,
                              tracksXml: tracks.code === 200 ? tracks.xml : null,
                              statusXml: status.code === 200 ? status.xml : null,
                              anrXml: anr.code === 200 ? anr.xml : null,
                              hostsXml: hosts.code === 200 ? hosts.xml : null,
                              storageSupported: storage.code === 200,
                              searchXml }) });
  } catch (e) { _camFail(res, e.message); }
});

// GET /httphost-backup?camera_id=X — the PLURAL document (every slot). UVSS
// cameras carry two httpHosts; a slot-1-only capture would restore a device
// that is missing its other push target.
app.get('/httphost-backup', async (req, res) => {
  if (!_requireSecret(req, res)) return;
  const cam = _findCam(req, res, String(req.query.camera_id || '').trim());
  if (!cam) return;
  try {
    const { code, xml } = await _camReq(cam, 'GET', _httpHostUri(null));
    if (code !== 200) return _camFail(res, `camera HTTP ${code}`, xml);
    res.json({ ok: true, raw_xml: xml, slots: _parseSlots(xml) });
  } catch (e) { _camFail(res, e.message); }
});

// POST /httphost-set { camera_id, slot } — repoint one slot at this edge's own
// lpr-receiver. The destination is DERIVED (edge's routed IP + our port + the
// camera's own push token), never accepted from the caller: an operator typo in
// a free-text field would silently redirect a government ANPR feed.
app.post('/httphost-set', express.json(), async (req, res) => {
  if (!_requireSecret(req, res)) return;
  const { camera_id, slot, kind, format } = req.body || {};
  const cam = _findCam(req, res, String(camera_id || '').trim());
  if (!cam) return;
  // kind defaults to 'lpr' so every existing caller — the dashboard buttons, the
  // C28/C29 cutover — behaves exactly as before. 'face' points the slot at the
  // face receiver using that camera's own face token instead.
  const isFace = String(kind || 'lpr') === 'face';
  const token = isFace ? cam.face_push_token : cam.lpr_push_token;
  if (!token) return res.status(400).json({ error: `camera has no ${isFace ? 'face_push_token' : 'lpr_push_token'} — generate one first` });
  const pushPath = isFace ? `/face-push/${token}` : `/lpr/${token}`;
  // Only ever XML or JSON, and only when asked. An arbitrary string here would
  // be written straight into the camera's config.
  const fmt = ['XML', 'JSON'].includes(String(format || '').toUpperCase())
    ? String(format).toUpperCase() : undefined;
  const slotId = parseInt(slot, 10) || 1;
  try {
    const cur = await _camReq(cam, 'GET', _httpHostUri(slotId));
    if (cur.code !== 200) return _camFail(res, `camera GET HTTP ${cur.code}`, cur.xml);

    const ip = env.str('LPR_PUSH_HOST') || cur.localAddress;
    if (!ip) return res.status(500).json({ error: 'could not determine edge address' });
    const body = retargetHttpHost(cur.xml, { ip, port: PORT, url: pushPath, format: fmt });

    const put = await _camReq(cam, 'PUT', _httpHostUri(slotId), body);
    if (put.code !== 200) return _camFail(res, `camera PUT HTTP ${put.code}`, put.xml);

    // Verify-after: report what the device actually holds, not what we sent.
    const after = await _camReq(cam, 'GET', _httpHostUri(slotId));
    res.json({ ok: true, target: { ip, port: PORT, url: pushPath, format: fmt || '(unchanged)' },
               before: _parseSlots(cur.xml)[0] || null, after: _parseSlots(after.xml)[0] || null });
  } catch (e) { _camFail(res, e.message); }
});

// POST /httphost-restore { camera_id, slot, raw_xml } — PUT a stored capture
// back verbatim. Deliberately depends on nothing but the blob it is handed (no
// token lookup, no derived address): this is the path that has to work when
// everything else is broken.
app.post('/httphost-restore', express.json({ limit: '256kb' }), async (req, res) => {
  if (!_requireSecret(req, res)) return;
  const { camera_id, slot, raw_xml } = req.body || {};
  const cam = _findCam(req, res, String(camera_id || '').trim());
  if (!cam) return;
  if (!raw_xml || !/<HttpHostNotification/i.test(raw_xml))
    return res.status(400).json({ error: 'raw_xml missing or not an HttpHostNotification' });
  const slotId = parseInt(slot, 10) || 1;
  // A stored PLURAL capture has to be split back into its per-slot documents —
  // the camera only accepts a single <HttpHostNotification> on /httpHosts/<id>.
  const body = /<HttpHostNotificationList/i.test(raw_xml) ? _sliceSlot(raw_xml, slotId) : raw_xml;
  if (!body) return res.status(400).json({ error: `slot ${slotId} not found in backup` });
  try {
    const put = await _camReq(cam, 'PUT', _httpHostUri(slotId), body);
    if (put.code !== 200) return _camFail(res, `camera PUT HTTP ${put.code}`, put.xml);
    const after = await _camReq(cam, 'GET', _httpHostUri(slotId));
    res.json({ ok: true, after: _parseSlots(after.xml)[0] || null });
  } catch (e) { _camFail(res, e.message); }
});

// Shared ONVIF Events-service SOAP round trip (GetEventBrokers / AddEventBroker).
// cam must already be decrypted. Resolves { code, xml } or rejects with Error.
function onvifEventsSoap(cam, bodyInner) {
  return new Promise((resolve, reject) => {
    const sec = buildOnvifSecurityHeader(cam.username || cam.http_user || '', cam.password || '');
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tev="http://www.onvif.org/ver10/events/wsdl"><s:Header>${sec}</s:Header><s:Body>${bodyInner}</s:Body></s:Envelope>`;
    const req2 = http.request({
      method: 'POST', host: cam.ip_address, port: cam.http_port || 80,
      path: '/onvif/event_service',
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, (r) => {
      let xml = ''; r.on('data', d => { xml += d; }); r.on('end', () => resolve({ code: r.statusCode, xml }));
    });
    req2.on('error', reject);
    req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
    req2.write(body); req2.end();
  });
}
function parseEventBrokers(xml) {
  const brokers = [];
  for (const m of xml.matchAll(/<tev:EventBroker>([\s\S]*?)<\/tev:EventBroker>/g)) {
    const block = m[1];
    brokers.push({
      address: (block.match(/<tev:Address>([^<]*)<\/tev:Address>/) || [])[1] || '',
      topicPrefix: (block.match(/<tev:TopicPrefix>([^<]*)<\/tev:TopicPrefix>/) || [])[1] || '',
      status: (block.match(/<tev:Status>([^<]*)<\/tev:Status>/) || [])[1] || '',
    });
  }
  return brokers;
}

// POST /event-broker-status — ONVIF GetEventBrokers on a Bosch camera, compares
// the configured broker Address against this edge's own MQTT broker
// (FACE_PUSH_HOST — same value nanomq/mosquitto listens on for pushed events).
// Read-only. body.camera_id looks up a saved camera's stored credentials;
// if that's not found (camera not saved yet — dashboard's pre-save "test
// before you commit" flow), falls back to the raw ip_address/username/password
// also in the body, gathered straight from the still-unsaved form.
app.post('/event-broker-status', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const camera_id = String(req.body?.camera_id || '').trim();
  const { ip_address, http_port, username, password } = req.body || {};

  let cam = camera_id ? decryptCamCreds((loadCameraConfig().cameras || []).find(c => c.camera_id === camera_id)) : null;
  if (!cam && ip_address) cam = { ip_address, http_port: parseInt(http_port, 10) || 80, username, password };
  if (!cam || !cam.ip_address) return res.status(404).json({ error: 'camera not found — save it first, or fill in IP/username/password to test' });

  try {
    const { code, xml } = await onvifEventsSoap(cam, '<tev:GetEventBrokers/>');
    if (code !== 200) {
      const fault = (xml.match(/<SOAP-ENV:Text[^>]*>([^<]+)/) || [])[1];
      return res.status(502).json({ error: fault || `camera HTTP ${code}` });
    }
    const brokers = parseEventBrokers(xml);
    const expected = FACE_PUSH_HOST_EDGE ? `mqtt://${FACE_PUSH_HOST_EDGE}` : '';
    const match = expected ? brokers.find(b => b.address === expected) : null;
    res.json({
      brokers,
      expected_address: expected || null,
      ok: !!match && match.status === 'Connected',
      current: match || null,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /event-broker-configure?camera_id=X — ONVIF AddEventBroker: registers this
// edge's own MQTT broker as an Event Broker on a Bosch camera, so it starts
// pushing events without anyone opening Bosch Configuration Manager. Additive
// only — if the camera already has OTHER brokers (different Address, e.g. from
// Configuration Manager), they're left untouched; we only add/fix our own entry,
// keyed by Address + TopicPrefix (both must match camera_id's expected values —
// see the comment at the match below for why Address alone isn't enough). Root
// cause of the earlier Phase 0 failures: the operation is `AddEventBroker`, not
// `CreateEventBroker` (the latter doesn't exist in the ONVIF Events WSDL) — see
// docs/superpowers/plans/2026-07-24-bosch-mqtt-broker.md.
app.post('/event-broker-configure', async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const camera_id = String(req.query.camera_id || '').trim();
  if (!camera_id) return res.status(400).json({ error: 'camera_id required' });
  if (!FACE_PUSH_HOST_EDGE) return res.status(503).json({ error: 'FACE_PUSH_HOST not configured on this edge' });

  const cam = decryptCamCreds((loadCameraConfig().cameras || []).find(c => c.camera_id === camera_id));
  if (!cam) return res.status(404).json({ error: 'camera not found' });

  const expected = `mqtt://${FACE_PUSH_HOST_EDGE}`;
  try {
    const before = await onvifEventsSoap(cam, '<tev:GetEventBrokers/>');
    if (before.code !== 200) {
      const fault = (before.xml.match(/<SOAP-ENV:Text[^>]*>([^<]+)/) || [])[1];
      return res.status(502).json({ error: fault || `camera HTTP ${before.code}` });
    }
    // Match on Address AND TopicPrefix — an entry pointing at our edge but with
    // a stale/hand-typed prefix (e.g. left over from Configuration Manager) is
    // NOT "already configured": mqtt-subscriber routes by parts[0] === camera_id,
    // so a wrong prefix means events silently never reach us despite the broker
    // showing Connected. Re-sending AddEventBroker with the same Address modifies
    // that entry in place (ONVIF matches on Address) rather than duplicating it.
    const existing = parseEventBrokers(before.xml).find(b => b.address === expected && b.topicPrefix === camera_id);
    if (existing) {
      return res.json({ ok: true, alreadyConfigured: true, current: existing, brokers: parseEventBrokers(before.xml) });
    }

    const addInner = `<tev:AddEventBroker><tev:EventBroker><tev:Address>${expected}</tev:Address><tev:TopicPrefix>${camera_id}</tev:TopicPrefix><tev:QoS>0</tev:QoS></tev:EventBroker></tev:AddEventBroker>`;
    const added = await onvifEventsSoap(cam, addInner);
    if (added.code !== 200) {
      const fault = (added.xml.match(/<SOAP-ENV:Text[^>]*>([^<]+)/) || [])[1];
      return res.status(502).json({ error: fault || `camera HTTP ${added.code}` });
    }

    const after = await onvifEventsSoap(cam, '<tev:GetEventBrokers/>');
    const brokers = after.code === 200 ? parseEventBrokers(after.xml) : [];
    const current = brokers.find(b => b.address === expected) || null;
    res.json({ ok: true, alreadyConfigured: false, current, brokers });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// POST /blacklist-source-test — read-only connectivity probe for the blacklist
// import settings page (docs/superpowers/specs/2026-07-24-blacklist-central-
// database-design.md). Central cannot reach these LAN systems (DSS Pro/
// GuruSquare/Dahua NVR) directly; edge can. Per-source named probes only
// (blacklistSourceProbes.js) — never a generic "fetch this URL". Credentials
// are used for this one call only; nothing here persists them.
const { testDssPro, testGuruSquare, testDahuaNvrFace, testDahuaNvrLpr, fetchGuruSquareRange, fetchGuruSquareAlerts, fetchGuruSquareLprMatch, fetchDssProPersons, fetchDssProVehicles, discoverSource, testHcp, fetchHcpFaces, fetchHcpVehicles, listHcpFaceGroups } = require('./helpers/blacklistSourceProbes');
// ── HC2 — ค้นใบหน้าด้วยรูป ผ่าน HCP ────────────────────────────
//
// อยู่ที่ edge เพราะ **central ไปไม่ถึง HCP** (10.0.10.9 ping ไม่ติด) · central
// รับรูปจากผู้ใช้แล้ว POST มาที่นี่ ทางเดียวกับ blacklist-source-* ที่ใช้อยู่แล้ว
// จึงไม่ได้เปิดช่องทางเข้าเครื่องที่ตั้งอยู่สถานีเพิ่มแต่อย่างใด
//
// edge ไม่เก็บอะไรไว้: รูปเข้ามาในหน่วยความจำ แปลงเป็น model ส่งให้ HCP แล้วจบ
// การบันทึกว่าใครค้นอะไร (PDPA) ทำที่ central **ก่อน** ยิงมา ไม่ใช่หลังสำเร็จ
app.post('/hcp-face-search', express.json({ limit: '12mb' }), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const { pictureData, since, until, cameraIndexCodes, threshold, maxResults, targetIndex } = req.body || {};
  if (!pictureData) return res.status(400).json({ error: 'ต้องส่ง pictureData (base64)' });
  if (!since || !until) return res.status(400).json({ error: 'ต้องระบุ since และ until' });

  try {
    // เพดานทั้งหมด (ช่วงเวลา · ขนาด batch · จำนวนคำขอ) อยู่ใน helper ตัวเดียว
    // ที่ central ใช้ร่วมกัน — ปฏิเสธก่อนแตะ HCP และบอกตัวเลขจริงเสมอ
    const plan = planHcpSearch({ since, until, cameraIndexCodes });
    if (plan.error) return res.status(400).json(plan);
    const { windows, camBatches } = plan;

    const hcp = require('./hcp-client');
    await hcp.init();

    // เลือก Fusion Server แบบค้นหา ไม่ hardcode — index ต่างกันได้ทุกไซต์ และ
    // BA server (type 3) ตอบ code 10 ซึ่งอ่านเหมือนโค้ดเราพัง
    const srvResp = await hcp.queryIntelligentServers();
    if (String(srvResp.body.code) !== '0') throw new Error(`intelligentServerList code=${srvResp.body.code}`);
    const servers = ((srvResp.body.data || {}).list || []).filter((x) => String(x.intelligentServerType) === '1');
    if (!servers.length) return res.status(409).json({ error: 'ไซต์นี้ไม่มี Intelligent Fusion Server — ค้นด้วยรูปไม่ได้' });
    const srv = servers[0].intelligentServerIndexCode;

    const pm = await hcp.pictureRecognitionModel(srv, String(pictureData).replace(/^data:image\/[a-z]+;base64,/, ''));
    if (String(pm.body.code) !== '0') throw new Error(`pictureRecognitionModel code=${pm.body.code} ${pm.body.msg || ''}`);
    const targets = ((pm.body.data || {}).targets || []);
    if (!targets.length) return res.status(422).json({ error: 'ไม่พบใบหน้าในรูปที่ส่งมา', faces: 0 });
    // รูปหนึ่งใบมีหลายหน้าได้ — ให้ผู้ใช้เลือกได้ว่าจะค้นหน้าไหน
    const tgt = targets[Math.min(Number(targetIndex) || 0, targets.length - 1)];

    const out = [];
    let calls = 0, failed = 0;
    for (const [ws, we] of windows) {
      for (const batch of camBatches) {
        calls++;
        try {
          const cs = await hcp.captureSearch(srv, tgt.targetModelData, batch,
            hcpTime(ws), hcpTime(we), { threshold, maxResults });
          if (String(cs.body.code) !== '0') { failed++; continue; }
          out.push(...((cs.body.data || {}).targets || []));
        } catch { failed++; }
      }
    }

    // similarity ที่นี่เป็น 0-1 อยู่แล้ว — เรียงมากไปน้อยข้ามทุกหน้าต่าง เพราะ
    // HCP เรียงให้เฉพาะภายในคำขอเดียว
    out.sort((a, b) => Number(b.similarity) - Number(a.similarity));
    res.json({
      ok: true, server: srv, facesInPicture: targets.length,
      calls, failedCalls: failed, windows: windows.length, cameraBatches: camBatches.length,
      results: out.slice(0, Number(maxResults) || 100),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /hcp-picture — ดึงรูปจากคลังรูปของ HCP (`picUrl`/`subpicUrl` ที่ captureSearch ส่งมา)
// URL พวกนี้เป็น http ธรรมดาในวง LAN ของ HCP ซึ่ง central ไปไม่ถึง จึงต้องผ่าน edge
//
// 🔒 รับเฉพาะรูปแบบเดียวเท่านั้น — `http://10.0.10.x:6120/isapiHikStor?...` · ไม่ใช่ "ดึง URL
// อะไรก็ได้" เพราะ URL เดินทางผ่านเบราว์เซอร์ ถ้าไม่จำกัดจะกลายเป็นช่องให้ยิงเข้าเครือข่าย
// ภายในผ่านเครื่องเรา (SSRF)
const HCP_PIC_RE = /^http:\/\/10\.0\.10\.\d{1,3}:6120\/isapiHikStor\?[\w=&.%-]+$/;
const HCP_DEV_PIC_RE = /^Dev:\/\/isapiHikStor\?[\w=&.%-]+$/;
// รูปของเหตุการณ์เป็นภาพเต็ม ~0.9 MB ต่อใบ · เปิดหน้าหนึ่งทีขอพร้อมกันเป็นสิบ แย่งอุโมงค์เดียวกับข้อมูลเข้า
// ⇒ ให้ทีละไม่เกิน 3 ใบ ที่เหลือรอคิว (ไม่ปฏิเสธ — เบราว์เซอร์ขอซ้ำไม่ได้ผลดีกว่า)
const PIC_MAX = 3; let _picActive = 0; const _picWait = [];
const _picAcquire = () => new Promise((ok) => { if (_picActive < PIC_MAX) { _picActive++; ok(); } else _picWait.push(ok); });
const _picRelease = () => { const n = _picWait.shift(); if (n) n(); else _picActive--; };
app.post('/hcp-picture', express.json(), (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  const url = String((req.body || {}).url || '');
  // รูปของเหตุการณ์ (eventRecords) เป็น `Dev://isapiHikStor?…` ไม่ใช่ http — ขอผ่าน API ของ HCP เอง
  // ไม่ได้ยิง URL ออกไปเอง จึงไม่เปิดช่อง SSRF · ผลเป็น data URI base64
  if (HCP_DEV_PIC_RE.test(url)) {
    return _picAcquire().then(() => require('./hcp-client').getPicture(url)).then((r) => {
      const m = /^data:image\/jpeg;base64,(.+)$/s.exec(String((r.body || {}).raw || ''));
      const b = m && Buffer.from(m[1], 'base64');
      if (!b || b[0] !== 0xff || b[1] !== 0xd8) return res.status(502).json({ error: 'ไม่ใช่ JPEG' });
      res.type('jpeg').send(b);
    }).catch((e) => res.status(502).json({ error: e.message })).finally(_picRelease);
  }
  if (!HCP_PIC_RE.test(url)) return res.status(400).json({ error: 'url ไม่อยู่ในรูปแบบที่อนุญาต' });
  const r = http.get(url, { timeout: 15000 }, (rs) => {
    if (rs.statusCode !== 200) { rs.resume(); return res.status(502).json({ error: `HTTP ${rs.statusCode}` }); }
    const chunks = [];
    let size = 0;
    rs.on('data', (c) => { size += c.length; if (size > 8 * 1024 * 1024) { rs.destroy(); } else chunks.push(c); });
    rs.on('end', () => {
      const b = Buffer.concat(chunks);
      if (b[0] !== 0xff || b[1] !== 0xd8) return res.status(502).json({ error: 'ไม่ใช่ JPEG' });
      res.type('jpeg').send(b);
    });
  });
  r.on('timeout', () => { r.destroy(); res.status(504).json({ error: 'timeout' }); });
  r.on('error', (e) => res.status(502).json({ error: e.message }));
});

// FR-P4 — ค้นใบหน้าด้วยเครื่องของเราเอง (ไม่ผ่าน HCP)
//
// ตัวเครื่องค้นเป็นบริการ Python แยกต่างหาก ฟังที่ 127.0.0.1 เท่านั้น เพราะโมเดล
// ต้องค้างอยู่ในหน่วยความจำ (โหลดใหม่ทุกคำขอกิน ~4 วินาที ซึ่งนานกว่าการค้นเอง)
// เส้นทางนี้เป็นแค่ประตูหน้าที่มีด่าน Bearer เดิม — ไม่ได้เปิดพอร์ตใหม่ออกนอกเครื่อง
const FACE_ENGINE = `http://127.0.0.1:${env.int('FR_PORT')}`;
function faceEngine(path, payload, res, timeoutMs = 60000) {
  const body = payload === null ? null : JSON.stringify(payload);
  const r = http.request(`${FACE_ENGINE}${path}`, {
    method: body === null ? 'GET' : 'POST', timeout: timeoutMs,
    headers: body === null ? {} : { 'Content-Type': 'application/json',
                                    'Content-Length': Buffer.byteLength(body) },
  }, (rs) => {
    let d = '';
    rs.on('data', (c) => { d += c; });
    rs.on('end', () => {
      try { res.status(rs.statusCode).json(JSON.parse(d)); }
      catch { res.status(502).json({ ok: false, error: d.slice(0, 300) }); }
    });
  });
  r.on('timeout', () => { r.destroy(); res.status(504).json({ ok: false, error: 'face-engine timeout' }); });
  // ECONNREFUSED = บริการยังไม่ได้สตาร์ท — บอกตรง ๆ ไม่ใช่ปล่อยให้ดูเหมือน "ค้นแล้วไม่เจอ"
  r.on('error', (e) => res.status(503).json({ ok: false,
    error: e.code === 'ECONNREFUSED' ? 'บริการค้นใบหน้าบน edge ยังไม่ได้เริ่มทำงาน' : e.message }));
  if (body !== null) r.write(body);
  r.end();
}

app.post('/face-engine-search', express.json({ limit: '12mb' }), (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  if (!(req.body || {}).image_b64) return res.status(400).json({ ok: false, error: 'ต้องส่ง image_b64' });
  faceEngine('/search', req.body, res);
});

app.get('/face-engine-stats', (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  faceEngine('/stats', null, res, 15000);
});

// Phase 1 (AuraFace-v1, Internal Test Only) — worker บน central เรียกทางนี้เพื่อฝัง
// embedding ภาพที่มีอยู่แล้วบน edge นี้เอง (ส่งแค่ rel_path ไป ไม่ต้องอัปโหลดภาพ)
app.post('/face-engine-embed', express.json({ limit: '1mb' }), (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  if (!(req.body || {}).rel_path) return res.status(400).json({ ok: false, error: 'ต้องส่ง rel_path' });
  faceEngine('/embed', req.body, res, 20000);
});

// Phase 5 — search-by-example: ภาพอัปโหลดสด ๆ ไม่ได้อยู่บน edge (ต่างจาก /face-engine-embed
// ที่ใช้ rel_path) จึงต้องส่ง base64 เหมือน /face-engine-search เดิม แต่ฝังด้วย AuraFace-v1
// การเทียบกับ face_embeddings ทำที่ central (routes/hcp.js) ไม่ใช่ที่นี่
app.post('/face-engine-embed-query', express.json({ limit: '12mb' }), (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  if (!(req.body || {}).image_b64) return res.status(400).json({ ok: false, error: 'ต้องส่ง image_b64' });
  faceEngine('/embed-query', req.body, res, 20000);
});

// HC-R — ความสามารถที่ต่อได้แล้วแต่ปิดสวิตช์ไว้ (ดู helpers/hcpOptional.js)
// GET = ดูว่ามีอะไรบ้างและอันไหนเปิดอยู่ · POST = เรียกใช้ (403 ถ้ายังปิด)
app.get('/hcp-optional', (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  const { listCaps } = require('./helpers/hcpOptional');
  res.json({ ok: true, caps: listCaps() });
});

app.post('/hcp-optional', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  try {
    const { runCap } = require('./helpers/hcpOptional');
    const r = await runCap(String((req.body || {}).cap || ''), (req.body || {}).params);
    if (r.error) return res.status(400).json(r);
    if (r.off) return res.status(403).json(r);       // ปิดอยู่ ≠ พัง — บอกให้ชัด
    res.json(r);
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// POST /hcp-events — เหตุการณ์ของ HCP ยกเว้น LPR/ใบหน้า (HC5) · อ่านอย่างเดียว
app.post('/hcp-events', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  try {
    const { fetchHcpEvents } = require('./helpers/hcpEvents');
    const b = req.body || {};
    res.json(await fetchHcpEvents({ since: b.since, until: b.until, types: b.types, limit: b.limit }));
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// GET /hcp-devices — สถานะอุปกรณ์ทั้งหมดที่ HCP ดูแล (HC4) · อ่านอย่างเดียว
// ยอดรวมของทุกชนิด + รายการกล้อง/เครื่องบันทึกให้ central เอาไปเทียบว่าตัวไหนเราดูแลด้วย
app.get('/hcp-devices', async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  try {
    const { fetchHcpDevices } = require('./helpers/hcpDevices');
    res.json(await fetchHcpDevices());
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// ── AcuSeek (ค้นวิดีโอด้วยข้อความ) ───────────────────────────────────────
// อยู่ที่นี่ด้วยเหตุผลเดียวกับ HCP: central ไปไม่ถึง 10.0.10.12 · ใช้ credential
// ชุดเดียวกับกล้อง Hikvision ที่ถอดรหัสจาก cameras-config.json อยู่แล้ว
//
// ⚠️ ข้อความที่ส่งมาต้องเป็น **ภาษาอังกฤษแล้ว** — central แปลให้ก่อน (acuseekPhrase)
// เครื่องปฏิเสธ language:"Thai" แม้จะประกาศว่ารองรับ (ทดสอบแล้ว 2026-08-12)
function _acuseekCreds() {
  // loadCameraConfig() ถอดรหัสให้แล้วและ cache ตาม mtime — ไม่อ่านไฟล์ซ้ำทุกคำขอ
  const cam = (loadCameraConfig().cameras || [])
    .find((c) => /hik/i.test(c.vendor || '') && c.username && c.password);
  if (!cam) throw new Error('ไม่พบ credential ของกล้อง Hikvision ใน cameras-config.json');
  return { user: cam.username, pass: cam.password };
}

app.post('/acuseek-search', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  try {
    const { submit } = require('./helpers/acuseek');
    const { user, pass } = _acuseekCreds();
    res.json(await submit(req.body || {}, user, pass));
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.post('/acuseek-status', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  try {
    const { status } = require('./helpers/acuseek');
    const { user, pass } = _acuseekCreds();
    res.json(await status(b.taskID, b.position, b.maxResults, user, pass));
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// รายการช่อง + IP กล้องจริงที่อยู่หลัง NVR แต่ละตัว — central เอาไปจับคู่กับ cameras
// ต้องถาม NVR ต่ออีกชั้นเพราะ AcuSeek รับภาพจาก NVR ไม่ใช่กล้องโดยตรง (ยืนยันครบ 72 ช่อง)
app.get('/acuseek-channels', async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  try {
    const { channels } = require('./helpers/acuseek');
    const { resolveCameraIps } = require('./helpers/acuseekChannelMap');
    const { user, pass } = _acuseekCreds();
    const c = await channels(user, pass);
    if (!c.ok) return res.status(502).json({ ok: false, error: `acuseek HTTP ${c.code}` });
    res.json({ ok: true, channels: await resolveCameraIps(c.channels, user, pass) });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// GET /hcp-camera-map — ส่งแมปที่ **ไฟล์บนเครื่องนี้** ถืออยู่จริง ให้ central เอาไป
// เทียบกับตาราง hcp_camera_map · ไฟล์นี้ก๊อปมือมาและ gitignored จึงดริฟต์ได้เงียบ ๆ
// (ผลคือ HC1 ตั้งชื่อไฟล์รูปด้วยกล้องผิดตัว ดู helpers/hcpCameraMap.js)
app.get('/hcp-camera-map', (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  const file = env.str('HCP_CAMERA_MAP') || path.join(__dirname, 'hcp-camera-map.json');
  try {
    const map = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ file, count: Object.keys(map).length, map });
  } catch (e) {
    // ไม่มีไฟล์ = ไซต์นี้ไม่ได้ต่อ HCP · บอกไปตรง ๆ ไม่ใช่ 500
    res.status(404).json({ error: e.message, file });
  }
});

app.post('/blacklist-source-test', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const { source, config, dataType } = req.body || {};
  try {
    let result;
    if (source === 'dss_pro') result = await testDssPro(config || {});
    else if (source === 'gurusquare') result = await testGuruSquare(config || {});
    else if (source === 'dahua_nvr') result = dataType === 'lpr' ? await testDahuaNvrLpr(config || {}) : await testDahuaNvrFace(config || {});
    // hcp ไม่รับ config เลย — กุญแจอยู่ใน env ของ edge เครื่องนี้ (ดู blacklistSourceProbes)
    else if (source === 'hcp') result = await testHcp();
    else return res.status(400).json({ error: 'unknown source' });
    res.json(result);
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// POST /blacklist-source-fetch — the IMPORT path (unmasked, one date window).
// Same bearer gate as the probe above. Photos are downscaled here at the edge
// before crossing the tunnel (see fetchGuruSquareRange for the 376MB reason).
// Central is what encrypts and stores; this endpoint keeps nothing.
app.post('/blacklist-source-fetch', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const { source, config, from, to, withPhotos, page, pageSize, withDetail, dataType, kind, plate } = req.body || {};
  try {
    let result;
    if (source === 'gurusquare') {
      // kind dispatch added 2026-09-24 (alarm feed): '/alert' + fallback
      // '/lprresult' match are separate request shapes from the roster import
      // above. No kind at all = the pre-existing roster path, unchanged.
      if (kind === 'alert') result = await fetchGuruSquareAlerts({ ...(config || {}), from, to, withPhotos });
      else if (kind === 'lprresult') result = await fetchGuruSquareLprMatch({ ...(config || {}), from, to, plate });
      else result = await fetchGuruSquareRange({ ...(config || {}), from, to, withPhotos });
    }
    else if (source === 'dss_pro') {
      result = dataType === 'lpr'
        ? await fetchDssProVehicles({ ...(config || {}), page, pageSize })
        : await fetchDssProPersons({ ...(config || {}), page, pageSize, withPhotos, withDetail });
    }
    else if (source === 'hcp') {
      const b = req.body || {};
      // mode:'groups' = ขอแค่รายชื่อคลัง · จากนั้น central ค่อยขอทีละคลัง
      // (ทั้งชุดพร้อมรูป ≈ 18 MB — ใหญ่เกินจะยัดคำขอเดียวข้ามอุโมงค์)
      if (b.mode === 'groups') result = await listHcpFaceGroups();
      else if (dataType === 'lpr') result = await fetchHcpVehicles();
      else result = await fetchHcpFaces({ group: b.group, withPhotos: b.withPhotos !== false,
                                         havePhotos: b.havePhotos, haveRemarks: b.haveRemarks });
    }
    else return res.status(400).json({ error: 'unsupported source for import' });
    res.json(result);
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// POST /blacklist-source-push — the WRITE path. Same bearer gate as the read
// endpoints above, but this one changes a third-party system, so it accepts
// only the named operations in blacklistSourcePush.js and has no delete.
// Central decides what to send; this endpoint does not build a diff, does not
// decide, and keeps nothing.
const { pushDssPro } = require('./helpers/blacklistSourcePush');
app.post('/blacklist-source-push', express.json({ limit: '2mb' }), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });

  const { source, config, ops } = req.body || {};
  if (!Array.isArray(ops) || !ops.length) return res.status(400).json({ error: 'ops required' });
  try {
    if (source !== 'dss_pro') return res.status(400).json({ error: 'unsupported source for push' });
    const out = await pushDssPro({ ...(config || {}), ops });
    console.log(`[blacklist-push] dss_pro: ${out.results.length} op result(s), ${out.failed} failed`);
    res.json(out);
  } catch (e) {
    console.error('[blacklist-push] failed:', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /blacklist-source-discover — ask a LAN source what it actually holds
// (face count / lpr count) so the operator picks from reality rather than from
// whatever the settings page assumed the source could do.
app.post('/blacklist-source-discover', express.json(), async (req, res) => {
  const secret = env.str('SNAPSHOT_PROXY_SECRET');
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await discoverSource({ source: req.body?.source, ...(req.body?.config || {}) }));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Mount the SAME route modules api-server uses — no duplicated logic.
require('./routes/lpr')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });
require('./routes/face-push')(app, pool, { SNAPSHOT_DIR, loadCameraConfig });

// T2-A: proxy endpoint — Central api-server fetches N150 snapshots through here.
// Bearer token matches SNAPSHOT_PROXY_SECRET in both .env files.
const SNAPSHOT_PROXY_SECRET = env.str('SNAPSHOT_PROXY_SECRET');
const _serveSnapshots = require('express').static(SNAPSHOT_DIR, { dotfiles: 'deny', index: false });
const { thumbWidth } = require('./helpers/thumbWidths');

// `?w=N` — ย่อภาพ **ที่ edge** ก่อนส่งข้ามอุโมงค์ (2026-09-08)
// ของจริงที่ vss: ไฟล์ event ของ BOSCH_3100i_02 ใบละ ~703 KB · หน้า Events ขอ 20 ใบ
// พร้อมกัน = 14 MB ต่อการเปิดหนึ่งครั้ง ⇒ central timeout 8 วิ แล้วขึ้นการ์ด "Edge offline"
// ทั้งที่ไฟล์อยู่ครบ · ย่อที่ต้นทางเหลือใบละ ~25 KB
//
// ponytail: ย่อสดทุกครั้ง ไม่มี cache — N150 2 คอร์ต้องแบ่งแรงกับ ingester ด้วย
// ถ้าภาระตรงนี้เริ่มเห็นผล ทางต่อคือ cache ภาพย่อลงดิสก์ของ edge เอง (edge เก็บภาพย่อ
// ของภาพตัวเองไม่ใช่ปัญหา PDPA แบบที่ central เก็บสำเนา — ภาพต้นฉบับก็อยู่ที่นี่อยู่แล้ว)
function _resizeSnapshot(req, res, next) {
  const w = thumbWidth(req.query.w);
  if (!w) return next();                       // ไม่ใช่คำขอภาพย่อ → static ตามเดิม
  // req.path ตรงนี้ถูกตัด mount prefix ออกแล้ว (`/events/…` ไม่ใช่ `/snapshots/events/…`)
  const rel = decodeURIComponent(req.path.replace(/^\//, ''));
  const segments = rel.split('/');
  if (!segments.length || !/\.(jpg|jpeg|png)$/i.test(rel)
      || segments.some((s) => !s || !/^[A-Za-z0-9._-]+$/.test(s))) return next();
  const file = path.join(SNAPSHOT_DIR, ...segments);
  if (!file.startsWith(SNAPSHOT_DIR + path.sep)) return next();
  require('sharp')(file, { failOn: 'none' })
    .resize(w, null, { withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer()
    .then((buf) => {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buf);
    })
    // ย่อไม่ได้ (ไฟล์หาย / ไม่ใช่ภาพ) = ปล่อยให้ static ตอบตามเดิม ห้ามกลืนเป็น 500
    .catch(() => next());
}

app.use('/snapshots', (req, res, next) => {
  if (!SNAPSHOT_PROXY_SECRET || req.headers['authorization'] !== `Bearer ${SNAPSHOT_PROXY_SECRET}`)
    return res.status(401).end();
  next();
}, _resizeSnapshot, _serveSnapshots);

const BIND_HOST = env.str('LPR_BIND_HOST');
const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`[lpr-receiver] listening on ${BIND_HOST}:${PORT} (/lpr, /face-push/:token, /healthz, /snapshots)`);
  warnVendorsWithoutProbePath();
});

function shutdown(sig) {
  console.log(`[lpr-receiver] ${sig} — closing`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
