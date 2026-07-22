// ============================================================
// Vigil Platform — Dahua RPC2 Stored-File Client
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
// Fetches the NVR's own already-stored detection JPEGs (face crop = ObjPath,
// full scene = OriPath on FaceComparision events) instead of asking the NVR
// to capture a fresh frame via snapshot.cgi — which stalls for minutes under
// AI load (live-measured 2026-07-15: only ~50-63% of captures succeeded).
//
// Mechanism (ground-truthed 2026-07-15 from the NVR web UI's own network
// traffic, then replicated live — see session notes): the /IntelliStorage/
// mnt/<packed-file>:<length>.jpg paths carried in FaceComparision event
// payloads are directly GET-able from the NVR web server — no /RPC_Loadfile
// prefix (that endpoint hangs on these paths), no digest auth. What they
// need is a WebClientSessionID cookie from an RPC2 login:
//   1. POST /RPC2_Login  global.login (empty password)  → {realm, random, session}
//   2. hash = MD5(user:random:MD5(user:realm:pass).upper()).upper()
//   3. POST /RPC2_Login  global.login (hashed password) → result:true
//   4. GET <IntelliStorage path> with Cookie: WebClientSessionID=<session>
// Session is kept alive via global.keepAlive; on auth failure the fetch
// re-logins once and retries. All failures resolve null (callers fall back
// to the old captureFrame() path) — this module must never break ingestion.
'use strict';

const http = require('http');
const crypto = require('crypto');

const KEEPALIVE_INTERVAL_MS = 60_000;   // NVR default session timeout is 300s
const RPC_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 12_000;

const md5up = (s) => crypto.createHash('md5').update(s).digest('hex').toUpperCase();

// deviceKey (host:port:user) → { session, timer, loggingIn: Promise|null }
const _sessions = new Map();

function _rpc(host, port, path, payload, session) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      host, port, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(session ? { Cookie: `WebClientSessionID=${session}` } : {}),
      },
      timeout: RPC_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('non-JSON RPC response')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.end(body);
  });
}

async function _login(cam) {
  const host = cam.ip_address, port = cam.http_port || 80;
  let id = 0;
  const c1 = await _rpc(host, port, '/RPC2_Login', {
    method: 'global.login', id: ++id, session: 0,
    params: { userName: cam.username, password: '', clientType: 'Web3.0', loginType: 'Direct' },
  });
  if (!c1?.params?.random || !c1?.params?.realm || !c1?.session) {
    throw new Error('RPC2 login challenge missing fields');
  }
  const hash = md5up(`${cam.username}:${c1.params.random}:${md5up(`${cam.username}:${c1.params.realm}:${cam.password}`)}`);
  const c2 = await _rpc(host, port, '/RPC2_Login', {
    method: 'global.login', id: ++id, session: c1.session,
    params: { userName: cam.username, password: hash, clientType: 'Web3.0', loginType: 'Direct', authorityType: 'Default', passwordType: 'Default' },
  }, c1.session);
  if (!c2?.result) throw new Error(`RPC2 login rejected${c2?.error?.message ? `: ${c2.error.message}` : ''}`);
  return c1.session;
}

function _deviceKey(cam) {
  return `${cam.ip_address}:${cam.http_port || 80}:${cam.username}`;
}

async function _ensureSession(cam) {
  const key = _deviceKey(cam);
  const entry = _sessions.get(key);
  if (entry?.session) return entry.session;
  if (entry?.loggingIn) return entry.loggingIn;   // coalesce concurrent logins

  const loggingIn = _login(cam).then((session) => {
    const timer = setInterval(() => {
      _rpc(cam.ip_address, cam.http_port || 80, '/RPC2',
        { method: 'global.keepAlive', id: 1, session, params: { timeout: 300, active: false } }, session)
        .then((r) => { if (!r?.result) _dropSession(key); })
        .catch(() => _dropSession(key));
    }, KEEPALIVE_INTERVAL_MS);
    timer.unref?.();
    _sessions.set(key, { session, timer, loggingIn: null });
    return session;
  }).catch((e) => {
    _sessions.delete(key);
    throw e;
  });
  _sessions.set(key, { session: null, timer: null, loggingIn });
  return loggingIn;
}

function _dropSession(key) {
  const entry = _sessions.get(key);
  if (entry?.timer) clearInterval(entry.timer);
  _sessions.delete(key);
}

function _fetchWithSession(cam, storagePath, session) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.get({
      host: cam.ip_address, port: cam.http_port || 80,
      path: encodeURI(storagePath),
      headers: {
        Cookie: `WebClientSessionID=${session}`,
        Referer: `http://${cam.ip_address}/`,
      },
      timeout: FETCH_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const soi = buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8;
        const eoi = buf.length >= 4 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
        if (res.statusCode === 200 && soi && eoi) return done(buf);
        done({ authFailed: res.statusCode === 401 || res.statusCode === 403 });
      });
    });
    req.on('error', () => done({ authFailed: false }));
    req.on('timeout', () => { req.destroy(); done({ authFailed: false }); });
  });
}

/**
 * Fetch a stored JPEG from the NVR by its IntelliStorage path.
 * Resolves a Buffer on success, null on any failure (never throws) —
 * callers treat null as "fall back to the live captureFrame() path".
 *
 * @param {object} cam  camera row with ip_address/http_port/username/password
 * @param {string} storagePath  e.g. "/IntelliStorage/mnt/0-41519-0-2-1-0:1414.jpg"
 */
async function fetchStoredFile(cam, storagePath) {
  if (!storagePath || !storagePath.startsWith('/')) return null;
  try {
    let session = await _ensureSession(cam);
    let r = await _fetchWithSession(cam, storagePath, session);
    if (Buffer.isBuffer(r)) return r;
    if (r?.authFailed) {
      // stale session (NVR rebooted / session expired between keepAlives) —
      // drop it, re-login once, retry once.
      _dropSession(_deviceKey(cam));
      session = await _ensureSession(cam);
      r = await _fetchWithSession(cam, storagePath, session);
      if (Buffer.isBuffer(r)) return r;
    }
    return null;
  } catch (e) {
    console.warn(`  ⚠️  [${cam.camera_id || cam.ip_address}] RPC stored-file fetch failed:`, e.message);
    return null;
  }
}

module.exports = { fetchStoredFile };
