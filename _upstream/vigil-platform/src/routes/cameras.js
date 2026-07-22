// ============================================================
// Vigil Platform — Routes: Cameras
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================
'use strict';

const http  = require('http');
const https = require('https');
const net   = require('net');
const routeError         = require('../helpers/routeError');
const normalizeTimeOfDay = require('../helpers/normalizeTimeOfDay');
const { parseChallenge, buildDigestHeader } = require('../helpers/digestAuth');
const { OFFLINE_THRESHOLD_SEC } = require('../constants');
const publishSiteConfig = require('../helpers/publishSiteConfig');
const emqxPublish   = require('../helpers/emqxPublish');
const scanRegistry  = require('../helpers/scanRegistry');
const { parseChannelTitles } = require('../ingesters/dahua-channels');
const { detectModel } = require('../model-detect');
const { deleteCameraMedia } = require('../camera-media-delete');
// push_only cameras are event-driven (Alarm Server / ANPR push) with no
// continuous heartbeat — a quiet stretch (no faces/plates) is not "offline".
// LPR's subscribe heartbeat keeps it fresh anyway; this 30-min grace only
// rescues face-push cameras from false offline during quiet periods.
const PUSH_ONLY_OFFLINE_SEC = 30 * 60;

const FULL_VIEW_WIDTHS = new Set([960, 1280, 1920, 2560]);
const EMQX_API_BASE    = 'http://localhost:18083/api/v5';
const EMQX_AUTHN_ID    = 'password_based%3Abuilt_in_database';

// SEC-008: detect private/loopback/link-local ranges. Audit-log only, never
// blocks — on-prem admin needs LAN cameras + on-prem forward partners are legit.
// Enable hard-rejection only for a multi-tenant cloud SKU.
function _isPrivateIp(ip) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.|::1$|fc[0-9a-f]{2}:|fe80:)/i.test(ip) ||
         /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
}

// CS6: validate an LPR forward endpoint URL set by an admin. Hard-reject what
// forwardToPhuket can't use — malformed or non-http(s) scheme (no legit forward
// target is file://, gopher://, …). Private/loopback hosts are ALLOWED but
// flagged (on-prem partner is legitimate — SEC-008 warn-not-block convention).
// ponytail: literal-IP check only, no DNS resolution — admin-only threat, push
// hot path; runtime is already guarded by forwardToPhuket's try/catch.
function _validateForwardUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: true, url: '' };                 // empty = forwarding off (decision B)
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'invalid_url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'bad_scheme' };
  if (!u.hostname) return { ok: false, error: 'invalid_url' };
  return { ok: true, url: s, isPrivate: _isPrivateIp(u.hostname) };
}

module.exports = function camerasRoutes(app, pool, {
  auth, getIP,
  loadCameraConfig, saveCameraConfig,
  loadGroups, saveGroups,
  logCameraAudit,
  getMapboxToken,
  license, getCurrentLicenseState,
  thumbWidth, jpegResizer,
  SNAPSHOT_DIR,
}) {

  // Alias to keep all internal call sites unchanged
  const _logCameraAudit = logCameraAudit;

  // ── camera_id sanitiser ──────────────────────────────────────
  // Strips invisible characters that destroy MQTT topic matching.
  // Most common offender: Thai phinthu U+0E3A that sneaks in from a
  // Thai keyboard layout when typing Latin-looking IDs (incident 2026-05-19).
  function _sanitizeCameraId(raw) {
    const original = String(raw || '').trim();
    const cleaned = original.replace(
      /[\x00-\x1f\x7f\u200b-\u200f\ufeff\u0e3a\u0e48-\u0e4e]/g, ''
    );
    return { cleaned, hadDirt: cleaned !== original };
  }

  function _redactCameraAudit(cam) {
    if (!cam || typeof cam !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(cam)) {
      // mqtt_password also redacted — mqtt_provisioned audit event carries the
      // "new password generated" signal separately, so no audit signal is lost.
      out[key] = ['username', 'password', 'mqtt_password', 'face_push_token', 'lpr_push_token'].includes(key) && value ? '***' : value;
    }
    return out;
  }

  // Redact for GET /api/cameras response sent to non-admin roles.
  // mqtt_password is also redacted (plain-text secret); mqtt_username is left
  // visible since it's deterministic (cam-<id>) and not a secret.
  function _redactCameraResponse(cam) {
    if (!cam || typeof cam !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(cam)) {
      out[key] = ['username', 'password', 'mqtt_password', 'face_push_token', 'lpr_push_token'].includes(key) && value ? '***' : value;
    }
    return out;
  }

  // ── EMQX auto-provision (SEC-001 Phase 2 — called on Bosch camera save) ──
  async function _emqxProvisionCamera(cam) {
    // หมายเหตุ: api-server โหลด env จาก src/.env (PM2 cwd=src) — key นี้ต้องอยู่
    // ที่นั่น ไม่ใช่แค่ root .env ของ docker-compose (incident 2026-06-11:
    // ย้ายมา PM2 แล้ว key หล่น → provision คืน null → UI ค้าง "กำลัง provision")
    const dashPass = process.env.EMQX_DASHBOARD_PASSWORD;
    if (!dashPass) {
      console.warn('[emqx-provision] EMQX_DASHBOARD_PASSWORD not set in src/.env — cannot provision');
      return null;
    }

    // Login to EMQX dashboard API
    const loginRes = await fetch(`${EMQX_API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: dashPass }),
    });
    if (!loginRes.ok) throw new Error(`EMQX login failed: HTTP ${loginRes.status}`);
    const { token } = await loginRes.json();

    const mqttUser = 'cam-' + cam.camera_id.toLowerCase().replace(/_/g, '-');
    // Reuse existing password (idempotent); generate new only for first-time provision
    const isNew = !cam.mqtt_password;
    const mqttPass = cam.mqtt_password || require('crypto').randomBytes(18).toString('base64url');

    const createRes = await fetch(`${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ user_id: mqttUser, password: mqttPass, is_superuser: false }),
    });

    if (createRes.status === 409) {
      // User exists — update password only if reusing (keeps EMQX in sync)
      const updRes = await fetch(
        `${EMQX_API_BASE}/authentication/${EMQX_AUTHN_ID}/users/${encodeURIComponent(mqttUser)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ password: mqttPass, is_superuser: false }),
        }
      );
      if (!updRes.ok) throw new Error(`EMQX update user failed: HTTP ${updRes.status}`);
    } else if (!createRes.ok) {
      throw new Error(`EMQX create user failed: HTTP ${createRes.status}`);
    }

    return { mqtt_username: mqttUser, mqtt_password: mqttPass, generated_new: isNew };
  }

  function _diffAuditObjects(before, after) {
    const a = before || {};
    const b = after || {};
    const changed = {};
    for (const key of Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        changed[key] = { before: a[key] ?? null, after: b[key] ?? null };
      }
    }
    return changed;
  }

  function _cameraGroupIds(groups, cameraId) {
    return (groups?.groups || [])
      .filter(g => (g.cameraIds || []).includes(cameraId))
      .map(g => g.id);
  }

  // ── Snapshot-path auto-detect (Phase MV.4b) ──────────────────
  // Dahua / generic-ONVIF cameras have no single universal snapshot URL.
  // Rather than make the operator hunt for it, probe a list of known
  // candidate paths and return the first that answers with a JPEG. The
  // camera-settings "🔍 ตรวจหาอัตโนมัติ" button calls this; on a miss the
  // operator types the path manually. Digest AND Basic auth are handled.
  const SNAPSHOT_CANDIDATES = {
    dahua: [
      '/cgi-bin/snapshot.cgi?channel=1',
      '/cgi-bin/snapshot.cgi?channel=0',
      '/cgi-bin/snapshot.cgi',
      '/cgi-bin/snapshot.cgi?1',
      '/onvif/snapshot',
    ],
    onvif: [
      '/onvif/snapshot',
      '/onvif-http/snapshot?Profile_1',
      '/snapshot.jpg',
      '/snap.jpg',
      '/image/jpeg.cgi',
      '/jpg/image.jpg',
      '/cgi-bin/snapshot.cgi?channel=1',
      '/axis-cgi/jpg/image.cgi',
      '/ISAPI/Streaming/channels/101/picture',
      '/tmpfs/auto.jpg',
    ],
  };

  // _isPrivateIp + _validateForwardUrl are module-level (SEC-008 / CS6) — see top of file.

  // Fetch <uri> and resolve true only if it answers 200 with a JPEG
  // (Content-Type image/* OR a body starting with the JPEG magic FF D8 —
  // guards against cameras that 200 an HTML error page). Handles the
  // Digest 401 two-step and a Basic fallback. ~5s timeout.
  function _probeHttpImage(host, port, uri, user, pass) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      const attempt = (authHeader) => {
        const headers = {};
        if (authHeader) headers.Authorization = authHeader;
        const r = http.get({ host, port, path: uri, headers, timeout: 5000 }, (pr) => {
          if (pr.statusCode === 401 && !authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
            return finish(false);
          }
          if (pr.statusCode !== 200) { pr.resume(); return finish(false); }
          const ct = String(pr.headers['content-type'] || '').toLowerCase();
          let head = Buffer.alloc(0);
          pr.on('data', (c) => {
            head = Buffer.concat([head, c]);
            if (head.length >= 2) {
              const isJpeg = head[0] === 0xFF && head[1] === 0xD8;
              pr.destroy();
              finish(ct.includes('image') || isJpeg);
            }
          });
          pr.on('end', () => finish(ct.includes('image')));
        });
        r.on('error', () => finish(false));
        r.on('timeout', () => { r.destroy(); finish(false); });
      };
      attempt(null);
    });
  }

  // Fetch a snapshot image as base64 with Digest/Basic auth fallback.
  // Returns base64 string or null. Max body read 600 KB.
  function _fetchImageBase64(host, port, uri, user, pass) {
    return new Promise(resolve => {
      let settled = false;
      const finish = v => { if (!settled) { settled = true; resolve(v); } };
      const MAX_BYTES = 600 * 1024;

      const attempt = authHeader => {
        const headers = authHeader ? { Authorization: authHeader } : {};
        const r = http.get({ host, port, path: uri, headers, timeout: 8000 }, pr => {
          if (pr.statusCode === 401 && !authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
            return finish(null);
          }
          if (pr.statusCode !== 200) { pr.resume(); return finish(null); }
          const ct = String(pr.headers['content-type'] || '').toLowerCase();
          const chunks = [];
          let total = 0;
          pr.on('data', c => {
            total += c.length;
            if (total > MAX_BYTES) { pr.destroy(); return finish(null); }
            chunks.push(c);
          });
          pr.on('end', () => {
            const buf = Buffer.concat(chunks);
            const isJpeg = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8;
            finish((ct.includes('image') || isJpeg) ? buf.toString('base64') : null);
          });
        });
        r.on('error', () => finish(null));
        r.on('timeout', () => { r.destroy(); finish(null); });
      };
      attempt(null);
    });
  }

  // ── Hikvision ISAPI snapshot proxy ──────────────────────────
  // The picture endpoint rejects Basic auth, so this does the HTTP Digest
  // two-step (401 challenge → hashed retry) and pipes the JPEG through.
  // Same algorithm as the digest helper in src/ingesters/hikvision-isapi.js
  // — kept inline for the MVP; the MV.2 plugin refactor is the right time
  // to extract a shared lib.
  function _hikDigestSnapshot(host, port, uri, user, pass, res, sendError, resizeW) {
    const attempt = (authHeader) => {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;
      const r = http.get({ host, port, path: uri, headers, timeout: 5000 }, (pr) => {
        if (pr.statusCode === 401 && !authHeader) {
          const wa = pr.headers['www-authenticate'] || '';
          pr.resume();
          // Some generic ONVIF cameras challenge with Basic instead of Digest
          if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
          if (/basic/i.test(wa)) return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
          return sendError(502, 'Camera 401 — no supported auth challenge');
        }
        if (pr.statusCode !== 200) { pr.resume(); return sendError(502, `Camera returned ${pr.statusCode}`); }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-cache');
        if (resizeW) {
          const t = jpegResizer(resizeW);
          t.on('error', () => { try { res.end(); } catch {} });
          pr.pipe(t).pipe(res);
        } else {
          pr.pipe(res);
        }
        pr.on('error', () => res.end());
      });
      r.on('error', (e) => sendError(502, e.message));
      r.on('timeout', () => { r.destroy(); sendError(504, 'Timeout'); });
    };
    attempt(null);
  }

  // ============================================================
  // Routes
  // ============================================================

  // API: Frontend Config (expose safe env vars)
  app.get('/api/config', async (req, res) => {
    const mapboxToken = await getMapboxToken();
    // SEC-017: never send the raw token to the client — proxy handles it server-side.
    res.json({ mapboxAvailable: !!mapboxToken });
  });

  app.get('/api/cameras', async (req, res) => {
    try {
      let dbCameras = {};
      try {
        // Alias canonical schema columns back to legacy shape consumed by
        // the dashboard and merge logic below (camera_id / camera_name /
        // last_seen / location / status).
        const dbResult = await pool.query(`
          SELECT id   AS camera_id,
                 name AS camera_name,
                 ip_address,
                 location_label AS location,
                 last_seen_at   AS last_seen,
                 paused,
                 CASE WHEN paused THEN 'paused' WHEN enabled THEN 'online' ELSE 'offline' END AS status,
                 sd_status, recording_data_from, recording_data_until,
                 recording_count, sd_last_check_at,
                 enable_snapshot, enable_vca_overlay, enable_clip_capture,
                 clip_pre_sec, clip_post_sec,
                 overlay_show_bbox, overlay_show_zone, ignore_event_types,
                 site_id, cam_role, lpr_direction, sort_order,
                 nvr_channel, capture_categories, device_id, model, firmware, serial_number,
                 recording_nvr_id
            FROM cameras
           ORDER BY last_seen_at DESC NULLS LAST
        `);
        dbResult.rows.forEach(c => { dbCameras[c.camera_id] = c; });
      } catch (e) { /* ignore */ }

      const now = Date.now();
      const config = loadCameraConfig();
      const merged = (config.cameras || []).map(c => {
        const db = dbCameras[c.camera_id] || {};

        // 🆕 Heartbeat-based status: paused beats online/offline
        let status = 'offline';
        if (db.paused) {
          status = 'paused';
        } else if (db.last_seen) {
          const ageSec = (now - new Date(db.last_seen).getTime()) / 1000;
          const threshold = c.push_only ? PUSH_ONLY_OFFLINE_SEC : OFFLINE_THRESHOLD_SEC;
          if (ageSec < threshold) status = 'online';
        }

        // recording flag derived from ONVIF GetRecordingSummary.DataUntil: when
        // SD recording is actively writing, DataUntil tracks real time within
        // seconds of the moment the camera was probed. So freshness is judged
        // against sd_last_check_at (when we asked), NOT wall-clock "now" — edge-
        // site cameras are probed hourly by the edge node (see mqtt-subscriber.js
        // applySdStatusResult), so recording_data_until is routinely tens of
        // minutes old by render time even while genuinely still recording.
        // ~90s threshold gives leeway for clock skew between camera and prober.
        const dataUntilMs = db.recording_data_until ? new Date(db.recording_data_until).getTime() : 0;
        const checkedAtMs = db.sd_last_check_at ? new Date(db.sd_last_check_at).getTime() : now;
        const recording = dataUntilMs > 0 && (checkedAtMs - dataUntilMs) < 90 * 1000;

        return {
          ...c,
          status,
          last_seen: db.last_seen || null,
          recording,
          sd_status: db.sd_status || null,
          recording_data_from:  db.recording_data_from  || null,
          recording_data_until: db.recording_data_until || null,
          recording_count: db.recording_count ?? null,
          sd_last_check_at: db.sd_last_check_at || null,
          // Phase 6.1 — per-camera media capture toggles
          enable_snapshot:     db.enable_snapshot ?? true,
          enable_vca_overlay:  db.enable_vca_overlay ?? true,
          enable_clip_capture: db.enable_clip_capture ?? false,
          clip_pre_sec:        db.clip_pre_sec ?? 10,
          clip_post_sec:       db.clip_post_sec ?? 5,
          // Migration 043 — client-side overlay display toggles
          overlay_show_bbox:   db.overlay_show_bbox ?? true,
          overlay_show_zone:   db.overlay_show_zone ?? true,
          // Per-camera event suppression (MQTT ingestion)
          ignore_event_types:  db.ignore_event_types ?? [],
          // MS-3: multi-site fields
          site_id:  db.site_id  ?? null,
          cam_role: db.cam_role ?? 'standard',
          lpr_direction: db.lpr_direction ?? null,  // RF5
          sort_order: db.sort_order ?? null,
          model: db.model ?? null,
          firmware: db.firmware ?? null,
          serial_number: db.serial_number ?? null,
          recording_nvr_id: db.recording_nvr_id ?? null,
        };
      });

      // Manual grid order. A camera with no sort_order yet (never touched by
      // the reorder endpoint) keeps its cameras-config.json array position —
      // that's what made it "last" before this feature existed, and it's
      // also why a freshly-added camera still lands last: it's NULL until an
      // admin explicitly moves it via PATCH /api/cameras/reorder.
      merged.forEach((c, i) => { c._configIdx = i; });
      merged.sort((a, b) => (a.sort_order ?? (1e6 + a._configIdx)) - (b.sort_order ?? (1e6 + b._configIdx)));
      merged.forEach(c => { delete c._configIdx; });

      // MS-5: RBAC site scoping. allowedSites is pre-resolved by the global auth
      // middleware (auth.getAllowedSites): null=ALL, []=no sites (fail-open until P2),
      // [id,...]=filter. Internal service calls (no req.user) bypass scoping.
      let scoped = merged;
      const allowedSites = req.user?.allowedSites ?? null;
      if (allowedSites !== null && allowedSites.length > 0) {
        const allowed = new Set(allowedSites);
        scoped = merged.filter(c => allowed.has(c.site_id));
      }

      // Optional ?site_id= filter — coerce to number; absent → all (allowed) cameras
      const siteFilter = req.query.site_id ? Number(req.query.site_id) : null;
      const filtered = siteFilter ? scoped.filter(c => c.site_id === siteFilter) : scoped;

      // SEC-003: admin gets plaintext to prefill the camera-edit form;
      // viewer/auditor have no UI that needs RTSP/MQTT credentials
      const safe = req.user?.role === 'admin' ? filtered : filtered.map(_redactCameraResponse);
      res.json(safe);
    } catch (err) { routeError(res, err, 'GET /api/cameras'); }
  });

  app.post('/api/cameras', async (req, res) => {
    try {
      if (!req.body || !req.body.camera_id) return res.status(400).json({ error: 'camera_id is required' });

      const config = loadCameraConfig();
      if (!config.cameras) config.cameras = [];

      // Sanitise camera_id BEFORE anything else writes/looks it up. Three
      // classes of trouble we warn on (decision 2026-05-19, after the
      // BOSCH_8000i Thai-phinthu incident):
      //   1. Invisible/control characters in the id (auto-fixed; operator
      //      should re-type to avoid keyboard-layout repeats).
      //   2. Non-ASCII in the id — legitimate Thai camera_id is allowed,
      //      but operators commonly hit this by accident; flag for review.
      //   3. Same IP already used by a DIFFERENT camera_id — usually means
      //      hardware replacement; the operator should reuse the existing
      //      id, not create a parallel entry that fragments stats/alerts.
      // Operator overrides by re-sending with ?force=1 (frontend turns the
      // "ดำเนินการต่อ" confirm button into that query param).
      const { cleaned: cleanedId, hadDirt } = _sanitizeCameraId(req.body.camera_id);
      if (!cleanedId) return res.status(400).json({ error: 'camera_id is empty after stripping invisible characters' });

      const warnings = [];
      if (hadDirt) {
        warnings.push({
          code: 'invisible_chars_stripped',
          message_th: `camera_id เดิมมีอักขระมองไม่เห็น — แก้เป็น "${cleanedId}" แล้ว (ตรวจ keyboard layout ตอนพิมพ์ — Thai keyboard ค้างมัก typo อักขระเสริมเข้ามา)`,
        });
      }
      if (/[^\x20-\x7e]/.test(cleanedId)) {
        warnings.push({
          code: 'non_ascii_id',
          message_th: `camera_id "${cleanedId}" มีอักขระไม่ใช่ ASCII — ตรวจสอบให้แน่ใจว่าตั้ง MQTT topic prefix ที่ Bosch CM ให้ตรงกันเป๊ะ ๆ`,
        });
      }
      const ip = String(req.body.ip_address || '').trim();
      if (ip) {
        const ipDup = config.cameras.find(c => c.camera_id !== cleanedId && c.ip_address === ip);
        // Suppress the false positive for a legitimate multi-channel NVR (e.g.
        // Dahua ch0/ch1 sharing one device IP by design — dahua-cgi.js treats
        // same ip:port:user as ONE physical device with multiple channels).
        // Read nvr_channel from the EXISTING config entries, not req.body —
        // the edit form never sends nvr_channel (only set via the add-camera
        // flow, parsed further down at line ~585), so checking req.body here
        // would always see undefined and this check would never suppress.
        // Only suppress when BOTH sides have a defined, DISTINCT channel —
        // same channel number (or either side missing one) still warns, since
        // that's the genuine hardware-swap/accidental-duplicate case this
        // check exists for (live incident: HDY-NVR-04-ch0/ch1 name+location
        // got cross-written after an operator hit this warning while editing
        // one channel of a legitimate 2-channel NVR, 2026-07-16).
        const editingEntry = config.cameras.find(c => c.camera_id === cleanedId);
        const sameDeviceDifferentChannel = ipDup
          && editingEntry && Number.isInteger(editingEntry.nvr_channel)
          && Number.isInteger(ipDup.nvr_channel)
          && editingEntry.nvr_channel !== ipDup.nvr_channel;
        if (ipDup && !sameDeviceDifferentChannel) {
          warnings.push({
            code: 'duplicate_ip',
            message_th: `IP ${ip} ใช้อยู่กับกล้อง "${ipDup.camera_id}" แล้ว — ถ้าเปลี่ยน hardware ตัวเดียวกัน แนะนำใช้ camera_id เดิม "${ipDup.camera_id}" เพื่อรักษา historical events + alert rules + stats`,
            existing_camera_id: ipDup.camera_id,
          });
        }
      }
      // Soft-block on warnings unless the operator passed ?force=1.
      if (warnings.length > 0 && req.query.force !== '1') {
        return res.status(409).json({ warnings, suggested_camera_id: cleanedId });
      }
      // Body looks clean — replace camera_id with the sanitised version so
      // the downstream INSERT/UPDATE uses the canonical form.
      req.body.camera_id = cleanedId;

      // Phase 8.0 — camera-count enforcement against the active license's
      // tier limit. Only enforced when the public key is configured AND we
      // hold a LICENSED state (trial/no-license deployments get unlimited
      // headroom by design — once the operator activates a real license,
      // the cap kicks in). Edits to existing cameras (same id) always pass
      // regardless of count.
      if (license.isPublicKeyConfigured()) {
        const state = await getCurrentLicenseState();
        if (state.mode === 'LICENSED' && state.payload && state.payload.max_cameras) {
          const newId = String(req.body.camera_id).trim();
          const isUpdate = config.cameras.some(c => c.camera_id === newId);
          if (!isUpdate && config.cameras.length >= state.payload.max_cameras) {
            return res.status(403).json({
              error: 'license_camera_limit',
              message_th: `License ปัจจุบัน (${state.payload.tier}) รองรับสูงสุด ${state.payload.max_cameras} กล้อง — ติดต่อทีมงานเพื่ออัพเกรด`,
              max_cameras: state.payload.max_cameras,
              current_count: config.cameras.length,
              tier: state.payload.tier,
            });
          }
        }
      }

      // Existing entry (if this is an edit) — used to preserve optional
      // fields the form may not re-send (http_port / stream selectors).
      const prevIdx = config.cameras.findIndex(c => c.camera_id === cleanedId);
      const prev = prevIdx >= 0 ? (config.cameras[prevIdx] || {}) : {};
      const prevAudit = _redactCameraAudit(prev);

      const VALID_VENDORS = ['bosch', 'hikvision', 'dahua', 'onvif'];
      const vendorRaw = String(req.body.vendor || prev.vendor || 'bosch').toLowerCase();
      const newCam = {
        camera_id: String(req.body.camera_id).trim(),
        camera_name: String(req.body.camera_name || req.body.camera_id).trim(),
        vendor: VALID_VENDORS.includes(vendorRaw) ? vendorRaw : 'bosch',
        ip_address: String(req.body.ip_address || '').trim(),
        username: String(req.body.username || '').trim(),
        password: String(req.body.password || ''),
        latitude: req.body.latitude ? parseFloat(req.body.latitude) : null,
        longitude: req.body.longitude ? parseFloat(req.body.longitude) : null,
        location: String(req.body.location || '').trim(),
        notes: String(req.body.notes || '').trim(),
      };
      // Optional fields — body value wins, else preserve the existing entry's.
      // Omitted entirely (not null) when unset so the JSON stays tidy.
      const httpPort  = parseInt(req.body.http_port, 10)       || prev.http_port;
      const clipStr   = parseInt(req.body.clip_stream, 10)     || prev.clip_stream;
      const snapStr   = parseInt(req.body.snapshot_stream, 10) || prev.snapshot_stream;
      if (httpPort) newCam.http_port      = httpPort;
      if (clipStr)  newCam.clip_stream     = clipStr;
      if (snapStr)  newCam.snapshot_stream = snapStr;
      // snapshot_path — HTTP still-image path for the generic-HTTP vendors
      // (Dahua CGI, generic ONVIF). The form always sends the field, so body
      // value wins (lets the operator clear it); else preserve the entry's.
      const snapPath = req.body.snapshot_path !== undefined
        ? String(req.body.snapshot_path).trim()
        : String(prev.snapshot_path || '').trim();
      if (snapPath) newCam.snapshot_path = snapPath;
      // full_view_width — Phase 2 per-camera cap (px) for the "view full"
      // button. Empty / out-of-set = no cap (serve the native original).
      // The form always sends the field, so body wins (lets the operator
      // clear it back to native).
      const fullW = req.body.full_view_width !== undefined
        ? (FULL_VIEW_WIDTHS.has(parseInt(req.body.full_view_width, 10))
            ? parseInt(req.body.full_view_width, 10) : null)
        : (prev.full_view_width || null);
      if (fullW) newCam.full_view_width = fullW;
      // IM5 Phase 1 — site label (free string, all vendors). Tags which physical
      // site a camera belongs to so a future detector (IM5 Phase 2) can tell
      // "whole site/link down" from "one camera down". Explicit per-camera —
      // NEVER guessed from subnet/gateway. Body wins, else preserve; empty clears.
      const site = req.body.site !== undefined ? String(req.body.site).trim() : String(prev.site || '').trim();
      if (site) newCam.site = site;
      // push_only — Hikvision cameras that send events to us (FAS/ANPR push receiver)
      // and must NOT be pulled (the ingester skips them — IM1). Body wins, else preserve
      // the existing entry's flag so a form-edit never silently re-enables pull spam.
      const pushOnly = req.body.push_only !== undefined ? !!req.body.push_only : !!prev.push_only;
      if (pushOnly) newCam.push_only = true;
      // CS2/CS6 — per-camera LPR forward override (Hikvision only). Body wins (validated),
      // else preserve. Empty body value clears it → forwarding off (decision B = opt-in,
      // no global default). The lpr_forward_url change is captured in the camera_update
      // audit diff below (PDPA: plate/image egress to an external partner).
      if ((newCam.vendor || prev.vendor || 'bosch').toLowerCase() === 'hikvision') {
        if (req.body.lpr_forward_url !== undefined) {
          const fv = _validateForwardUrl(req.body.lpr_forward_url);
          if (!fv.ok) return res.status(400).json({ error: 'lpr_forward_url_invalid', reason: fv.error });
          if (fv.url) {
            newCam.lpr_forward_url = fv.url;
            if (fv.isPrivate) console.warn(`[SEC-008] LPR forward target is a private/loopback host: ${fv.url} (cam ${newCam.camera_id}) set by ${req.user?.username} (${getIP(req)})`);
          } // empty → leave unset = forwarding off
        } else if (prev.lpr_forward_url) {
          newCam.lpr_forward_url = prev.lpr_forward_url; // preserve on edit-without-field
        }
      }
      // Dahua NVR multi-channel support (Phase 1)
      // nvr_channel — 0-based Dahua NVR channel index. Body wins, else preserve.
      const nvrCh = req.body.nvr_channel !== undefined
        ? parseInt(req.body.nvr_channel, 10)
        : (prev.nvr_channel !== undefined ? prev.nvr_channel : undefined);
      if (nvrCh !== undefined && nvrCh >= 0 && Number.isInteger(nvrCh)) {
        newCam.nvr_channel = nvrCh;
      }
      // capture_categories — array of event categories to ingest (e.g. ['face'], ['anpr', 'vehicle']).
      // Body wins (if array), else preserve. Omitted if empty or not provided.
      const capCats = Array.isArray(req.body.capture_categories)
        ? req.body.capture_categories
        : (Array.isArray(prev.capture_categories) ? prev.capture_categories : undefined);
      if (Array.isArray(capCats) && capCats.length > 0) {
        newCam.capture_categories = capCats;
      }
      // Preserve MQTT credentials across edits — these are set by auto-provision
      // and must not be erased when the operator edits other camera fields.
      if (prev.mqtt_username) newCam.mqtt_username = prev.mqtt_username;
      if (prev.mqtt_password) newCam.mqtt_password = prev.mqtt_password;
      // Preserve the face-push token (IM3-R) — set by its own endpoint; a normal
      // form-edit must not wipe it (would break the camera's configured push URL).
      // Body may send '***' (redacted echo for non-admin) — never persist that.
      if (prev.face_push_token) newCam.face_push_token = prev.face_push_token;
      // Preserve the LPR push token — same pattern as face_push_token.
      if (prev.lpr_push_token) newCam.lpr_push_token = prev.lpr_push_token;

      const idx = prevIdx;
      if (idx >= 0) config.cameras[idx] = newCam;
      else config.cameras.push(newCam);

      if (!saveCameraConfig(config)) throw new Error('Failed to save config');

      // Auto-provision EMQX MQTT credentials for Bosch cameras (sync, 5s timeout)
      let mqttCreds = null;
      let mqttStatus = 'skipped';
      if ((newCam.vendor || 'bosch').toLowerCase() === 'bosch') {
        try {
          const provPromise = _emqxProvisionCamera(newCam);
          const timeoutPromise = new Promise((_, rej) =>
            setTimeout(() => rej(new Error('EMQX provision timeout')), 5000)
          );
          mqttCreds = await Promise.race([provPromise, timeoutPromise]);
          // null = EMQX_DASHBOARD_PASSWORD ไม่ถูกตั้ง — อย่าปล่อยไปตาย
          // ที่ null.mqtt_username ข้างล่าง (error เดิมหลอกทางหาสาเหตุ)
          if (!mqttCreds) throw new Error('EMQX_DASHBOARD_PASSWORD not set in src/.env');
          mqttStatus = 'provisioned';
          // Re-read config from disk (guards against concurrent writes) and
          // merge in the new credentials before writing back.
          const fresh = loadCameraConfig();
          const fi = fresh.cameras.findIndex(c => c.camera_id === newCam.camera_id);
          if (fi >= 0) {
            fresh.cameras[fi].mqtt_username = mqttCreds.mqtt_username;
            fresh.cameras[fi].mqtt_password = mqttCreds.mqtt_password;
            saveCameraConfig(fresh);
          }
          newCam.mqtt_username = mqttCreds.mqtt_username;
          newCam.mqtt_password = mqttCreds.mqtt_password;
        } catch (err) {
          console.warn('[emqx-provision]', newCam.camera_id, err.message);
          mqttStatus = 'pending'; // camera saved; EMQX provision deferred
        }
      }

      // Phase 6.1 — media capture toggles (DB-only, not in JSON config)
      let previousToggles = {};
      try {
        const tr = await pool.query(
          `SELECT enable_snapshot, enable_vca_overlay, enable_clip_capture, clip_pre_sec, clip_post_sec,
                  overlay_show_bbox, overlay_show_zone
             FROM cameras WHERE id=$1`,
          [newCam.camera_id]
        );
        previousToggles = tr.rows[0] || {};
      } catch {}
      const toggles = {
        enable_snapshot:     req.body.enable_snapshot     === undefined ? true  : !!req.body.enable_snapshot,
        enable_vca_overlay:  req.body.enable_vca_overlay  === undefined ? true  : !!req.body.enable_vca_overlay,
        enable_clip_capture: req.body.enable_clip_capture === undefined ? false : !!req.body.enable_clip_capture,
        clip_pre_sec:        Math.max(1, Math.min(60, parseInt(req.body.clip_pre_sec,  10) || 10)),
        clip_post_sec:       Math.max(0, Math.min(30, parseInt(req.body.clip_post_sec, 10) ||  5)),
        // Migration 043 — client-side overlay display toggles
        overlay_show_bbox:   req.body.overlay_show_bbox   === undefined ? true  : !!req.body.overlay_show_bbox,
        overlay_show_zone:   req.body.overlay_show_zone   === undefined ? true  : !!req.body.overlay_show_zone,
        // Per-camera event suppression (MQTT ingestion)
        ignore_event_types: Array.isArray(req.body.ignore_event_types) ? req.body.ignore_event_types : [],
      };

      const siteId = (req.body.site_id !== undefined && req.body.site_id !== null && req.body.site_id !== '')
        ? (parseInt(req.body.site_id, 10) || null) : null;
      // cam_role = manual deployment tag (standard|lpr|face). null = not in body →
      // COALESCE preserves the existing value (form-edit never silently resets it).
      const camRole = ['standard', 'lpr', 'face'].includes(req.body.cam_role) ? req.body.cam_role : null;

      try {
        // NVR channel config (migration 083). undefined → null → COALESCE keeps
        // the existing value so a plain form-edit never wipes it.
        const nvrChannel = Number.isInteger(newCam.nvr_channel) ? newCam.nvr_channel : null;
        const capCats    = Array.isArray(newCam.capture_categories) ? newCam.capture_categories : null;
        const deviceId   = newCam.device_id || null;
        const updateResult = await pool.query(
          `UPDATE cameras SET
             name=$2, ip_address=$3, location_label=$4,
             enable_snapshot=$5, enable_vca_overlay=$6,
             enable_clip_capture=$7, clip_pre_sec=$8, clip_post_sec=$9,
             overlay_show_bbox=$10, overlay_show_zone=$11, ignore_event_types=$12,
             site_id=$13, cam_role=COALESCE($14, cam_role),
             nvr_channel=COALESCE($15, nvr_channel),
             capture_categories=COALESCE($16, capture_categories),
             device_id=COALESCE($17, device_id)
           WHERE id=$1`,
          [newCam.camera_id, newCam.camera_name, newCam.ip_address, newCam.location,
           toggles.enable_snapshot, toggles.enable_vca_overlay,
           toggles.enable_clip_capture, toggles.clip_pre_sec, toggles.clip_post_sec,
           toggles.overlay_show_bbox, toggles.overlay_show_zone, toggles.ignore_event_types,
           siteId, camRole, nvrChannel, capCats, deviceId]
        );
        if (updateResult.rowCount === 0) {
          await pool.query(
            `INSERT INTO cameras (id, name, ip_address, location_label, enabled,
                                   enable_snapshot, enable_vca_overlay,
                                   enable_clip_capture, clip_pre_sec, clip_post_sec,
                                   overlay_show_bbox, overlay_show_zone, ignore_event_types,
                                   site_id, cam_role, nvr_channel, capture_categories, device_id)
             VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,'standard'),$15,$16,$17)`,
            [newCam.camera_id, newCam.camera_name, newCam.ip_address, newCam.location,
             toggles.enable_snapshot, toggles.enable_vca_overlay,
             toggles.enable_clip_capture, toggles.clip_pre_sec, toggles.clip_post_sec,
             toggles.overlay_show_bbox, toggles.overlay_show_zone, toggles.ignore_event_types,
             siteId, camRole, nvrChannel, capCats, deviceId]
          );
        }
      } catch (dbErr) { console.warn('DB sync warn:', dbErr.message); }

      // Dual-write ignore_event_types to cameras-config.json so mqtt-subscriber
      // picks up the change via fs.watch without a restart
      const cfgForIgnore = loadCameraConfig();
      const ignIdx = (cfgForIgnore.cameras || []).findIndex(c => c.camera_id === newCam.camera_id);
      if (ignIdx >= 0) {
        cfgForIgnore.cameras[ignIdx].ignore_event_types = toggles.ignore_event_types;
        saveCameraConfig(cfgForIgnore);
      }

      // EC1: push updated site config to edge via retained MQTT (fire-and-forget)
      if (siteId) publishSiteConfig(siteId, cfgForIgnore.cameras, pool).catch(e =>
        console.warn('[edge-config] publish failed:', e.message)
      );

      // OPT5-EDGE-004: trigger-on-save model detect (replaces one-time
      // fill-model.js). Fire-and-forget — never blocks the Save response.
      // Connection params travel in the request itself (not a _cameraMap
      // lookup) so this can't race the config-apply above for a brand-new or
      // just-edited camera. Edge-site cameras round-trip over MQTT (central
      // can't reach the edge LAN); central-reachable sites detect inline.
      (async () => {
        try {
          let siteCode = null;
          if (siteId) {
            const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
            siteCode = rows[0]?.code || null;
          }
          const detectReq = {
            camera_id: newCam.camera_id, ip_address: newCam.ip_address,
            http_port: newCam.http_port || 80, username: newCam.username,
            password: newCam.password, vendor: newCam.vendor,
            secret: process.env.CAMERA_SECRET_KEY, // SEC5-HIGH-003 mitigation: edge-config-agent command gate
          };
          if (siteCode && siteCode !== 'main') {
            await emqxPublish(`projects/${siteCode}/_config/detect-model`, detectReq);
          } else {
            const info = await detectModel(
              { ip_address: detectReq.ip_address, username: detectReq.username, vendor: detectReq.vendor },
              detectReq.password
            );
            if (info && info.model) {
              await pool.query(
                `UPDATE cameras SET model=$1, firmware=$2, serial_number=$3, model_detected_at=NOW(), model_detect_error=NULL WHERE id=$4`,
                [info.model, info.firmware, info.serial, newCam.camera_id]
              );
            } else {
              await pool.query(
                `UPDATE cameras SET model_detected_at=NOW(), model_detect_error=$1 WHERE id=$2`,
                ['unreachable, auth failed, or model not recognized', newCam.camera_id]
              );
            }
          }
        } catch (e) { console.warn('[model-detect] trigger-on-save failed:', e.message); }
      })();

      const action = prevIdx >= 0 ? 'camera_update' : 'camera_create';
      const before = prevIdx >= 0 ? { ...prevAudit, ...previousToggles } : null;
      const after = { ..._redactCameraAudit(newCam), ...toggles };
      await _logCameraAudit(req, action, newCam.camera_id, {
        camera_id: newCam.camera_id,
        changed_fields: before ? _diffAuditObjects(before, after) : after,
      });

      // Separate audit event for MQTT provision (security trail — compensates for
      // the trust boundary change: provisioning now possible from UI, not just SSH)
      if (mqttCreds) {
        await _logCameraAudit(req, 'mqtt_provisioned', newCam.camera_id, {
          mqtt_username: mqttCreds.mqtt_username,
          generated_new_password: mqttCreds.generated_new,
        });
      }

      res.json({
        success: true,
        camera: newCam,
        mqtt_status: mqttStatus,
        mqtt_broker_host: process.env.MQTT_CAMERA_BROKER_HOST || null,
      });
    } catch (err) { routeError(res, err, 'POST /api/cameras'); }
  });

  // POST /api/cameras/:id/mqtt/regenerate — force-rotate the MQTT password for
  // a Bosch camera. Returns the new cleartext password as a one-time reveal so
  // the operator can enter it in the camera's own web UI to reconnect.
  // NOTE: intentionally NOT passed through _redactCameraResponse — the
  // cleartext is the whole point; admin-only, one-time reveal on success.
  app.post('/api/cameras/:id/mqtt/regenerate', auth.requireAdmin, async (req, res) => {
    try {
      const rawId = req.params.id;
      if (!/^[a-z0-9-]+$/i.test(rawId)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const cameraId = rawId.toLowerCase();

      const config = loadCameraConfig();
      const idx = config.cameras.findIndex(c => c.camera_id === cameraId);
      if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
      const cam = config.cameras[idx];
      if ((cam.vendor || 'bosch').toLowerCase() !== 'bosch') {
        return res.status(400).json({ error: 'MQTT regenerate is only available for Bosch cameras' });
      }

      // Force-generate new password by stripping the existing one before provisioning
      const camForRegen = { ...cam, mqtt_password: undefined };
      const creds = await _emqxProvisionCamera(camForRegen);
      if (!creds) return res.status(503).json({ error: 'EMQX_DASHBOARD_PASSWORD not configured — cannot regenerate' });

      // Atomic write — re-read to guard against concurrent edits
      const fresh = loadCameraConfig();
      const fi = fresh.cameras.findIndex(c => c.camera_id === cameraId);
      if (fi >= 0) {
        fresh.cameras[fi].mqtt_username = creds.mqtt_username;
        fresh.cameras[fi].mqtt_password = creds.mqtt_password;
        if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');
      }

      await _logCameraAudit(req, 'mqtt_regenerated', cameraId, {
        mqtt_username: creds.mqtt_username,
      });

      res.json({ success: true, mqtt_username: creds.mqtt_username, mqtt_password: creds.mqtt_password });
    } catch (err) {
      console.error('[mqtt-regenerate]', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // POST /api/cameras/:id/face-push-token — generate (or rotate) the per-camera
  // secret token for the cross-site face-push receiver (IM3-R). Returns the token
  // so the UI can show the full https://<host>/face-push/<token> URL to enter in
  // the camera's Alarm Server. Admin-only; the token is a capability secret.
  // NB: do NOT lowercase camera_id (ids are case-sensitive, e.g. HIK-FACE-HKT01)
  // and allow underscore (e.g. BOSCH_*) — match the stored id exactly.
  app.post('/api/cameras/:id/face-push-token', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const config = loadCameraConfig();
      const idx = config.cameras.findIndex(c => c.camera_id === id);
      if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
      if ((config.cameras[idx].vendor || 'bosch').toLowerCase() !== 'hikvision') {
        return res.status(400).json({ error: 'Face push is only available for Hikvision cameras' });
      }

      const token = require('crypto').randomUUID();
      // Atomic write — re-read to guard against a concurrent edit clobbering it.
      const fresh = loadCameraConfig();
      const fi = fresh.cameras.findIndex(c => c.camera_id === id);
      if (fi < 0) return res.status(404).json({ error: 'Camera not found' });
      fresh.cameras[fi].face_push_token = token;
      if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');

      await _logCameraAudit(req, 'face_push_token_generated', id, {}); // never log the token value
      res.json({ success: true, token });
    } catch (err) {
      console.error('[face-push-token]', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // POST /api/cameras/:id/lpr-push-token — Generate a per-camera LPR push token
  // (mirrors face-push-token pattern). Token is embedded in the push URL path.
  // NB: do NOT lowercase camera_id (ids are case-sensitive, e.g. HIK-FACE-HKT01)
  // and allow underscore (e.g. BOSCH_*) — match the stored id exactly.
  app.post('/api/cameras/:id/lpr-push-token', auth.requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid camera_id format' });
      const config = loadCameraConfig();
      const idx = config.cameras.findIndex(c => c.camera_id === id);
      if (idx < 0) return res.status(404).json({ error: 'Camera not found' });
      if ((config.cameras[idx].vendor || 'bosch').toLowerCase() !== 'hikvision') {
        return res.status(400).json({ error: 'LPR push is only available for Hikvision cameras' });
      }

      const token = require('crypto').randomUUID();
      // Atomic write — re-read to guard against a concurrent edit clobbering it.
      const fresh = loadCameraConfig();
      const fi = fresh.cameras.findIndex(c => c.camera_id === id);
      if (fi < 0) return res.status(404).json({ error: 'Camera not found' });
      fresh.cameras[fi].lpr_push_token = token;
      if (!saveCameraConfig(fresh)) throw new Error('Failed to save config');

      await _logCameraAudit(req, 'lpr_push_token_generated', id, {}); // never log the token value
      res.json({ success: true, token });
    } catch (err) {
      console.error('[lpr-push-token]', err);
      res.status(500).json({ error: 'Internal server error', code: 'ERR_INTERNAL' });
    }
  });

  // POST /api/cameras/test-connection — TCP reachability + HTTP auth check.
  // Returns { reachable, auth_status: 'ok'|'failed'|'unknown', latency_ms }.
  // HTTP auth attempted only for Hikvision / Dahua (known HTTP camera API);
  // Bosch / ONVIF report auth_status='unknown' (they use MQTT / other proto).
  app.post('/api/cameras/test-connection', auth.requireAdmin, async (req, res) => {
    try {
      const { ip_address, http_port, vendor, username, password } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      if (_isPrivateIp(ip)) console.warn(`[SEC-008] test-connection targeting ${ip} by ${req.user?.username} (${getIP(req)})`);

      const port = parseInt(http_port, 10) || 80;
      const v = String(vendor || 'bosch').toLowerCase();
      const start = Date.now();

      const reachable = await new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(3000);
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('error', () => resolve(false));
        sock.once('timeout', () => { sock.destroy(); resolve(false); });
        sock.connect(port, ip);
      });
      const latency_ms = Date.now() - start;

      if (!reachable) return res.json({ reachable: false, auth_status: 'unknown', latency_ms });

      // HTTP auth test for vendors that expose an HTTP API
      let auth_status = 'unknown';
      if ((v === 'hikvision' || v === 'dahua') && username && password) {
        const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
        auth_status = await new Promise(resolve => {
          const r = http.get({ host: ip, port, path: '/', headers: { Authorization: authHeader }, timeout: 4000 }, (pr) => {
            pr.resume();
            resolve(pr.statusCode === 401 ? 'failed' : 'ok');
          });
          r.on('error', () => resolve('unknown'));
          r.on('timeout', () => { r.destroy(); resolve('unknown'); });
        });
      }

      res.json({ reachable: true, auth_status, latency_ms });
    } catch (e) { routeError(res, e, 'POST /api/cameras/test-connection'); }
  });

  // POST /api/cameras/lpr-forward-test — reachability probe for the LPR data-forward
  // endpoint (e.g. CIB). Sends an EMPTY POST (no PII to a gov endpoint) and reports
  // the raw HTTP status. NOTE: this proves "we can reach it + it answers", NOT that a
  // real ANPR push will be accepted (an empty body may get a different status than a
  // full multipart push). Status alone can't diagnose path-vs-IP — in this system a
  // wrong path AND an IP-block both returned 403 (session 2026-07-01) — so we report
  // the status honestly and don't guess the cause.
  app.post('/api/cameras/lpr-forward-test', auth.requireAdmin, async (req, res) => {
    try {
      const fv = _validateForwardUrl(req.body?.url);
      if (!fv.ok)  return res.status(400).json({ error: fv.error });   // bad scheme / invalid url
      if (!fv.url) return res.status(400).json({ error: 'empty_url' });
      if (fv.isPrivate) console.warn(`[SEC-008] lpr-forward-test → ${fv.url} (private target) by ${req.user?.username} (${getIP(req)})`);
      const u   = new URL(fv.url);
      const mod = u.protocol === 'https:' ? https : http;
      const start = Date.now();
      const result = await new Promise(resolve => {
        const preq = mod.request({
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: (u.pathname || '/') + (u.search || ''),
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 0 },
        }, r => { r.resume(); r.on('end', () => resolve({ reachable: true, status: r.statusCode })); });
        preq.on('error', e => resolve({ reachable: false, error: e.code || e.message }));
        preq.setTimeout(5000, () => { preq.destroy(); resolve({ reachable: false, error: 'timeout' }); });
        preq.end(); // empty body — probe only
      });
      res.json({ ...result, latency_ms: Date.now() - start });
    } catch (e) { routeError(res, e, 'POST /api/cameras/lpr-forward-test'); }
  });

  // POST /api/cameras/snapshot-preview — fetch a live JPEG and return as
  // base64. Probes candidate paths if snapshot_path is not provided.
  // Body: { vendor, ip_address, http_port, username, password, snapshot_path? }
  // Response: { found, snapshot_path?, image_base64? }
  app.post('/api/cameras/snapshot-preview', auth.requireAdmin, async (req, res) => {
    try {
      const { vendor, ip_address, http_port, username, password, snapshot_path } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      if (_isPrivateIp(ip)) console.warn(`[SEC-008] snapshot-preview targeting ${ip} by ${req.user?.username} (${getIP(req)})`);

      const v = String(vendor || 'onvif').toLowerCase();
      const port = parseInt(http_port, 10) || 80;
      const user = String(username || ''), pass = String(password || '');

      // Use provided path or probe for one
      let pathToUse = String(snapshot_path || '').trim();
      if (!pathToUse) {
        const candidates = SNAPSHOT_CANDIDATES[v] || SNAPSHOT_CANDIDATES.onvif;
        for (const uri of candidates) {
          const ok = await _probeHttpImage(ip, port, uri, user, pass);
          if (ok) { pathToUse = uri; break; }
        }
      }
      if (!pathToUse) return res.json({ found: false });

      const imageBase64 = await _fetchImageBase64(ip, port, pathToUse, user, pass);
      if (!imageBase64) return res.json({ found: false, snapshot_path: pathToUse });

      res.json({ found: true, snapshot_path: pathToUse, image_base64: imageBase64 });
    } catch (e) { routeError(res, e, 'POST /api/cameras/snapshot-preview'); }
  });

  // POST /api/cameras/probe-snapshot — { vendor, ip_address, http_port,
  // username, password } → { found, snapshot_path?, tried[] }. Admin-gated
  // by the requireAdminForWrites('/api/cameras') mount above.
  app.post('/api/cameras/probe-snapshot', async (req, res) => {
    try {
      const { vendor, ip_address, http_port, username, password } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      // SEC-008: log private-IP probes for audit trail (non-blocking — on-prem admin needs LAN access)
      // To enable blocking for cloud/multi-tenant SKU: uncomment the rejection below
      if (_isPrivateIp(ip)) {
        console.warn(`[SEC-008] probe-snapshot targeting private IP ${ip} by user ${req.user?.username} (${getIP(req)})`);
        // return res.status(400).json({ error: 'private IP not allowed' }); // enable for cloud SKU
      }
      const v = String(vendor || 'onvif').toLowerCase();
      const port = parseInt(http_port, 10) || 80;
      const candidates = SNAPSHOT_CANDIDATES[v] || SNAPSHOT_CANDIDATES.onvif;
      const tried = [];
      for (const uri of candidates) {
        const ok = await _probeHttpImage(ip, port, uri, username || '', password || '');
        tried.push(uri);
        if (ok) return res.json({ found: true, snapshot_path: uri, tried });
      }
      res.json({ found: false, tried });
    } catch (e) { routeError(res, e, 'POST /api/cameras/probe-snapshot'); }
  });

  // ── NVR channel scan (Phase 3) ─────────────────────────────────────
  // Fetch a text body (Dahua config CGI) with Digest/Basic auth fallback.
  // Caps the body at 256 KB — a ChannelTitle dump is tiny. Returns text or null.
  function _fetchHttpText(host, port, uri, user, pass) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      const attempt = (authHeader) => {
        const headers = {};
        if (authHeader) headers.Authorization = authHeader;
        const r = http.get({ host, port, path: uri, headers, timeout: 6000 }, (pr) => {
          if (pr.statusCode === 401 && !authHeader) {
            const wa = pr.headers['www-authenticate'] || '';
            pr.resume();
            if (/digest/i.test(wa)) return attempt(buildDigestHeader(user, pass, 'GET', uri, parseChallenge(wa)));
            if (/basic/i.test(wa))  return attempt('Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'));
            return finish(null);
          }
          if (pr.statusCode !== 200) { pr.resume(); return finish(null); }
          let body = '', len = 0;
          pr.on('data', (c) => { len += c.length; if (len > 262144) pr.destroy(); else body += c; });
          pr.on('end', () => finish(body));
        });
        r.on('error', () => finish(null));
        r.on('timeout', () => { r.destroy(); finish(null); });
      };
      attempt(null);
    });
  }
  const _CHANNEL_TITLE_URI = '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle';

  // POST /api/cameras/scan-nvr — enumerate an NVR's channels. Central-reachable
  // sites (main/unassigned) probe directly; edge sites round-trip the request
  // over MQTT to the site's edge-config-agent (central can't reach the edge
  // LAN). Body: { ip_address, http_port, username, password, site_id, vendor }.
  app.post('/api/cameras/scan-nvr', async (req, res) => {
    try {
      const { ip_address, http_port, username, password, site_id, vendor } = req.body || {};
      const ip = String(ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      if ((vendor || 'dahua').toLowerCase() !== 'dahua') return res.status(400).json({ error: 'NVR scan supports Dahua only' });
      if (_isPrivateIp(ip)) console.warn(`[SEC-008] scan-nvr targeting private IP ${ip} by user ${req.user?.username} (${getIP(req)})`);
      const port = parseInt(http_port, 10) || 80;

      let siteCode = null;
      if (site_id) {
        const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [parseInt(site_id, 10)]);
        siteCode = rows[0]?.code || null;
      }
      const isEdge = siteCode && siteCode !== 'main';

      if (!isEdge) {
        const text = await _fetchHttpText(ip, port, _CHANNEL_TITLE_URI, username || '', password || '');
        if (text == null) return res.status(502).json({ error: 'NVR unreachable or auth failed' });
        return res.json({ mode: 'direct', channels: parseChannelTitles(text) });
      }
      // edge site → publish request; client polls GET for the reply
      const scanId = require('crypto').randomUUID();
      scanRegistry.register(scanId);
      await emqxPublish(`projects/${siteCode}/_config/scan-nvr`,
        { scan_id: scanId, ip_address: ip, http_port: port, username: username || '', password: password || '' });
      res.json({ mode: 'edge', scan_id: scanId });
    } catch (e) { routeError(res, e, 'POST /api/cameras/scan-nvr'); }
  });

  // GET /api/cameras/scan-nvr/:scanId — poll for an edge scan reply.
  app.get('/api/cameras/scan-nvr/:scanId', (req, res) => {
    const e = scanRegistry.get(req.params.scanId);
    if (!e) return res.status(404).json({ error: 'unknown or expired scan' });
    if (e.status === 'ready') return res.json({ status: 'ready', channels: e.channels });
    if (e.status === 'error') return res.json({ status: 'error', error: e.error });
    res.json({ status: 'pending' });
  });

  // POST /api/cameras/bulk-create-channels — create one camera per selected NVR
  // channel in a single call. Body: { vendor, ip_address, http_port, username,
  // password, site_id, device_id, channels:[{nvr_channel, camera_id,
  // camera_name, capture_categories[]}] }. Existing camera_ids are skipped, not
  // overwritten. Passwords go into cameras-config.json in plaintext (same as the
  // single-create path); publishSiteConfig encrypts them on the way to the edge.
  const _CAP_CATS = ['face', 'anpr', 'vehicle', 'nonmotor', 'person', 'rule'];
  app.post('/api/cameras/bulk-create-channels', auth.requireAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const channels = Array.isArray(b.channels) ? b.channels : [];
      if (!channels.length) return res.status(400).json({ error: 'channels (non-empty array) required' });
      const ip = String(b.ip_address || '').trim();
      if (!ip) return res.status(400).json({ error: 'ip_address required' });
      const siteId  = b.site_id ? (parseInt(b.site_id, 10) || null) : null;
      const port    = parseInt(b.http_port, 10) || 80;
      const deviceId = String(b.device_id || '').trim() || null;

      const config = loadCameraConfig();
      const existing = new Set((config.cameras || []).map(c => c.camera_id));
      const created = [], skipped = [];
      for (const ch of channels) {
        const camId = String(ch.camera_id || '').trim();
        const nvrCh = parseInt(ch.nvr_channel, 10);
        if (!camId || !Number.isInteger(nvrCh)) { skipped.push({ camera_id: camId, reason: 'invalid' }); continue; }
        if (existing.has(camId)) { skipped.push({ camera_id: camId, reason: 'exists' }); continue; }
        const capCats = Array.isArray(ch.capture_categories)
          ? ch.capture_categories.filter(c => _CAP_CATS.includes(c)) : [];
        const camRole = ['standard', 'lpr', 'face'].includes(ch.cam_role) ? ch.cam_role : 'standard';
        const entry = {
          camera_id: camId,
          camera_name: String(ch.camera_name || camId).trim(),
          vendor: 'dahua',
          ip_address: ip,
          http_port: port,
          username: String(b.username || '').trim(),
          password: String(b.password || ''),
          cam_role: camRole,
          nvr_channel: nvrCh,
          ...(capCats.length ? { capture_categories: capCats } : {}),
          ...(deviceId ? { device_id: deviceId } : {}),
        };
        config.cameras.push(entry);
        existing.add(camId);
        await pool.query(
          `INSERT INTO cameras (id, name, ip_address, enabled, site_id, cam_role,
                                 nvr_channel, capture_categories, device_id)
             VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [camId, entry.camera_name, ip, siteId, camRole, nvrCh, capCats.length ? capCats : null, deviceId]
        ).catch(e => console.warn('[bulk-create] DB insert warn:', e.message));
        created.push(camId);
      }
      if (created.length) {
        saveCameraConfig(config);
        if (siteId) publishSiteConfig(siteId, config.cameras, pool).catch(e =>
          console.warn('[bulk-create] publishSiteConfig warn:', e.message));
      }
      res.json({ created, skipped });
    } catch (e) { routeError(res, e, 'POST /api/cameras/bulk-create-channels'); }
  });

  // POST /api/cameras/bulk-import — CSV-driven batch create of standalone cameras.
  // Body: { cameras: [{ camera_id, vendor, ip_address, site, camera_name?,
  //   cam_role?, username?, password?, http_port?, capture_categories?(array|';'str),
  //   location?, latitude?, longitude?, nvr_channel?, notes? }, ...] }
  // Partial success: bad rows are SKIPPED with a reason, never fail the batch.
  // 'site' resolves by site code, else site name → site_id. Created cameras are
  // enabled immediately; per affected non-main site we publishSiteConfig so the
  // owning edge picks them up right away. Passwords land plaintext in
  // cameras-config.json (same model as single/bulk create), encrypted on the way
  // to the edge. See docs/superpowers/plans/2026-07-17-bulk-camera-csv-import.md
  app.post('/api/cameras/bulk-import', auth.requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.cameras) ? req.body.cameras : [];
      if (!rows.length) return res.status(400).json({ error: 'cameras (non-empty array) required' });
      if (rows.length > 500) return res.status(413).json({ error: 'too many rows (max 500)' });
      const VENDORS = ['bosch', 'hikvision', 'dahua', 'onvif'];
      const ROLES   = ['standard', 'face', 'lpr'];
      const IPV4    = /^(\d{1,3}\.){3}\d{1,3}$/;

      // site lookup: code (lowercased) or name → { id, code }
      const { rows: siteRows } = await pool.query('SELECT id, code, name FROM sites');
      const siteByKey = new Map();
      for (const s of siteRows) {
        siteByKey.set(String(s.code).toLowerCase(), { id: s.id, code: s.code });
        siteByKey.set(String(s.name).toLowerCase(), { id: s.id, code: s.code });
      }

      const config = loadCameraConfig();
      const existing = new Set((config.cameras || []).map(c => c.camera_id));
      const created = [], skipped = [], affectedSites = new Set();

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        const rowNo = i + 1;
        const fail = (reason, camera_id) => skipped.push({ row: rowNo, camera_id: camera_id || null, reason });

        const { cleaned: camId } = _sanitizeCameraId(r.camera_id);
        if (camId.startsWith('#')) { fail('example row', camId); continue; }  // template sample — never import
        if (!camId) { fail('missing camera_id'); continue; }
        const vendor = String(r.vendor || '').toLowerCase().trim();
        if (!VENDORS.includes(vendor)) { fail('bad vendor', camId); continue; }
        const ip = String(r.ip_address || '').trim();
        if (!IPV4.test(ip)) { fail('bad ip_address', camId); continue; }
        const site = siteByKey.get(String(r.site || '').toLowerCase().trim());
        if (!site) { fail('unknown site', camId); continue; }
        if (existing.has(camId)) { fail('duplicate camera_id', camId); continue; }

        const camRole = ROLES.includes(String(r.cam_role || '').toLowerCase()) ? String(r.cam_role).toLowerCase() : 'standard';
        let capCats = r.capture_categories;
        if (typeof capCats === 'string') capCats = capCats.split(/[;,]/).map(s => s.trim());
        capCats = Array.isArray(capCats) ? capCats.filter(c => _CAP_CATS.includes(c)) : [];
        const nvrChParsed = parseInt(r.nvr_channel, 10);
        const nvrCh = Number.isInteger(nvrChParsed) ? nvrChParsed : null;

        const entry = {
          camera_id: camId,
          camera_name: String(r.camera_name || camId).trim(),
          vendor,
          ip_address: ip,
          http_port: parseInt(r.http_port, 10) || 80,
          username: String(r.username || '').trim(),
          password: String(r.password || ''),
          cam_role: camRole,
          ...(r.location ? { location: String(r.location).trim() } : {}),
          ...(r.latitude ? { latitude: parseFloat(r.latitude) } : {}),
          ...(r.longitude ? { longitude: parseFloat(r.longitude) } : {}),
          ...(r.notes ? { notes: String(r.notes).trim() } : {}),
          ...(nvrCh != null ? { nvr_channel: nvrCh } : {}),
          ...(capCats.length ? { capture_categories: capCats } : {}),
        };
        config.cameras.push(entry);
        existing.add(camId);
        await pool.query(
          `INSERT INTO cameras (id, name, ip_address, http_port, enabled, site_id, cam_role,
                                location_label, latitude, longitude, nvr_channel, capture_categories)
             VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO NOTHING`,
          [camId, entry.camera_name, ip, entry.http_port, site.id, camRole,
           entry.location || null, entry.latitude ?? null, entry.longitude ?? null,
           nvrCh, capCats.length ? capCats : null]
        ).catch(e => console.warn('[bulk-import] DB insert warn:', e.message));
        created.push(camId);
        if (site.code !== 'main') affectedSites.add(site.id);
      }

      if (created.length) {
        saveCameraConfig(config);
        for (const sid of affectedSites) {
          publishSiteConfig(sid, config.cameras, pool).catch(e =>
            console.warn('[bulk-import] publishSiteConfig warn:', e.message));
        }
      }
      res.json({ created, skipped });
    } catch (e) { routeError(res, e, 'POST /api/cameras/bulk-import'); }
  });

  // PATCH /api/cameras/reorder — set the manual grid order shown on the
  // Camera Status page. Body: { order: [camera_id, ...] } — the FULL list of
  // cameras currently known to the caller, in the desired order. Writes
  // 0..N-1 across all of them so nothing is left half-numbered.
  app.patch('/api/cameras/reorder', auth.requireAdmin, async (req, res) => {
    const order = Array.isArray(req.body?.order) ? req.body.order.map(String) : null;
    if (!order || !order.length) return res.status(400).json({ error: 'order (non-empty array) is required' });
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < order.length; i++) {
          await client.query('UPDATE cameras SET sort_order = $1 WHERE id = $2', [i, order[i]]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      res.json({ ok: true, count: order.length });
    } catch (e) { routeError(res, e, 'PATCH /api/cameras/reorder'); }
  });

  // PATCH /api/cameras/:cameraId/pause — set/clear maintenance pause flag
  // Dual-write: DB cameras.paused + cameras-config.json .paused (for ingesters)
  // On unpause: stamps last_seen_at=NOW() to prevent a transient watchdog offline alert
  app.patch('/api/cameras/:cameraId/pause', auth.requireAdmin, async (req, res) => {
    try {
      const { cameraId } = req.params;
      const paused = !!req.body?.paused;

      // RETURNING enabled captures the pre-pause state atomically.
      // `enabled` is frozen while paused (watchdog skips paused cameras),
      // so it reliably reflects whether the camera was online at pause time.
      const { rows } = await pool.query(
        `UPDATE cameras SET paused=$1, updated_at=NOW() WHERE id=$2 RETURNING id, enabled`,
        [paused, cameraId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Camera not found' });

      // On unpause — grace period: only stamp last_seen_at if the camera WAS online
      // when paused (enabled=true). Stamping for an offline camera causes false
      // online→offline churn (watchdog sees grace period then heartbeat timeout).
      const wasOnline = rows[0].enabled;
      if (!paused && wasOnline) {
        await pool.query(`UPDATE cameras SET last_seen_at=NOW() WHERE id=$1`, [cameraId]);
      }

      // Dual-write to cameras-config.json so ingesters pick up change via fs.watch
      const config = loadCameraConfig();
      const idx = (config.cameras || []).findIndex(c => c.camera_id === cameraId);
      if (idx >= 0) {
        config.cameras[idx].paused = paused;
        saveCameraConfig(config);
      }

      // Log status transition
      await pool.query(
        `INSERT INTO camera_status_log (camera_id, status, reason) VALUES ($1,$2,$3)`,
        [cameraId, paused ? 'paused' : 'resumed',
         paused ? 'operator paused (maintenance)' : 'operator resumed']
      );

      // Audit log
      await pool.query(
        `INSERT INTO audit_log (user_id, username, action, target_camera_id, details)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.user.id, req.user.username,
         paused ? 'camera_pause' : 'camera_resume',
         cameraId, JSON.stringify({ paused })]
      );

      res.json({ ok: true, paused });
    } catch (e) { routeError(res, e, 'PATCH /api/cameras/:cameraId/pause'); }
  });

  app.delete('/api/cameras/:cameraId', async (req, res) => {
    try {
      const { cameraId } = req.params;
      // keep_data=1 — remove the camera from the active config/groups but
      // preserve its historical events/appearances/license_plates (orphaned
      // rows: camera_id survives with no matching `cameras` row). Verified
      // 2026-07-16 that the LPR/faces/appearances listing routes don't INNER
      // JOIN cameras (appearances.js/lpr-query.js's main listing use LEFT
      // JOIN or none at all), so orphaned rows stay visible — only a couple
      // of minor camera-enriched stats (e.g. lpr_direction in/out chart) go
      // blank for them. Default (no param) keeps the original hard-delete
      // behavior — this is additive, not a behavior change for existing callers.
      const keepData = req.query.keep_data === '1';
      const config = loadCameraConfig();
      const prevCamera = (config.cameras || []).find(c => c.camera_id === cameraId) || null;
      const prevGroups = _cameraGroupIds(loadGroups(), cameraId);
      config.cameras = (config.cameras || []).filter(c => c.camera_id !== cameraId);
      saveCameraConfig(config);

      // Also remove from groups
      const groups = loadGroups();
      groups.groups = (groups.groups || []).map(g => ({
        ...g, cameraIds: (g.cameraIds || []).filter(id => id !== cameraId)
      }));
      saveGroups(groups);

      let siteId = null;
      try {
        if (!keepData) {
          await pool.query('DELETE FROM appearances WHERE camera_id = $1', [cameraId]);
          await pool.query('DELETE FROM license_plates WHERE camera_id = $1', [cameraId]);
          // face_event_notes/face_event_acks/lpr_alert_acks have no camera_id column —
          // scope via events.id subquery before events itself is deleted (no FK cascade
          // after MANUAL_partition_events_option_a.sql; Option A is app-enforced).
          await pool.query(
            'DELETE FROM face_event_notes WHERE event_id IN (SELECT id FROM events WHERE camera_id = $1)',
            [cameraId]
          );
          await pool.query(
            'DELETE FROM face_event_acks WHERE event_id IN (SELECT id FROM events WHERE camera_id = $1)',
            [cameraId]
          );
          await pool.query(
            'DELETE FROM lpr_alert_acks WHERE event_id IN (SELECT id FROM events WHERE camera_id = $1)',
            [cameraId]
          );
          await pool.query('DELETE FROM events WHERE camera_id = $1', [cameraId]);
        }
        const del = await pool.query('DELETE FROM cameras WHERE id = $1 RETURNING site_id', [cameraId]);
        siteId = del.rows[0]?.site_id ?? null;
      } catch (e) { /* ignore */ }

      // EC1: push the now-camera-removed config to the edge so its own ingester
      // stops watching a camera that no longer exists (Task #20 — this call was
      // missing, so a deleted camera's edge process kept polling/publishing it
      // forever off the last retained config it ever received).
      if (siteId) publishSiteConfig(siteId, config.cameras, pool).catch(e =>
        console.warn('[edge-config] publish failed:', e.message)
      );

      // OPT5-EDGE-005: clean up on-disk media, gated on the SAME !keepData flag
      // as the DB rows above — an operator who chose "delete but keep data"
      // means keep the images too. Fire-and-forget, never blocks the response.
      if (!keepData) {
        (async () => {
          try {
            let siteCode = null;
            if (siteId) {
              const { rows } = await pool.query('SELECT code FROM sites WHERE id = $1', [siteId]);
              siteCode = rows[0]?.code || null;
            }
            if (siteCode && siteCode !== 'main') {
              await emqxPublish(`projects/${siteCode}/_config/delete-media`, {
                camera_id: cameraId,
                secret: process.env.CAMERA_SECRET_KEY, // SEC5-HIGH-003 mitigation: edge-config-agent command gate
              });
            } else {
              const r = await deleteCameraMedia(SNAPSHOT_DIR, cameraId);
              if (r.rejected) console.warn(`[camera-media-delete] ${cameraId}: rejected`);
              else console.log(`[camera-media-delete] ${cameraId}: removed ${r.dirsRemoved} date-dir(s)`);
            }
          } catch (e) { console.warn('[camera-media-delete] trigger failed:', e.message); }
        })();
      }

      await _logCameraAudit(req, 'camera_delete', cameraId, {
        camera: _redactCameraAudit(prevCamera),
        removed_from_groups: prevGroups,
        kept_data: keepData,
      });

      res.json({ success: true, kept_data: keepData });
    } catch (err) { routeError(res, err, 'DELETE /api/cameras/:cameraId'); }
  });

  // ============================================================
  // API: Camera Offline Alerts + Status Log (Ph.1)
  // ============================================================

  // GET /api/camera-offline-alerts/:cameraId — return config (defaults if none)
  app.get('/api/camera-offline-alerts/:cameraId', auth.requireAuth, async (req, res) => {
    try {
      const { cameraId } = req.params;
      const { rows } = await pool.query(
        `SELECT * FROM camera_offline_alerts WHERE camera_id = $1`, [cameraId]
      );
      const row = rows[0] || {
        camera_id: cameraId, enabled: false,
        notify_after_sec: 300, escalate_interval_min: 60, escalate_once: false,
        quiet_from: null, quiet_to: null, recipient_ids: '',
      };
      res.json(row);
    } catch (err) { routeError(res, err, 'GET /api/camera-offline-alerts/:cameraId'); }
  });

  // PUT /api/camera-offline-alerts/:cameraId — upsert config
  app.put('/api/camera-offline-alerts/:cameraId', auth.requireAdmin, async (req, res) => {
    try {
      const { cameraId } = req.params;
      const { enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids } = req.body;
      const beforeResult = await pool.query(
        `SELECT enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids
           FROM camera_offline_alerts WHERE camera_id = $1`,
        [cameraId]
      );
      const before = beforeResult.rows[0] || null;

      const notifyAfter  = Math.max(30, Math.min(86400, parseInt(notify_after_sec, 10) || 300));
      const escalateMin  = Math.max(1,  Math.min(1440,  parseInt(escalate_interval_min, 10) || 60));
      const escalateOnce = !!escalate_once;
      let qf = null, qt = null;
      try { qf = normalizeTimeOfDay(quiet_from); } catch {}
      try { qt = normalizeTimeOfDay(quiet_to);   } catch {}

      await pool.query(
        `INSERT INTO camera_offline_alerts
           (camera_id, enabled, notify_after_sec, escalate_interval_min, escalate_once, quiet_from, quiet_to, recipient_ids, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (camera_id) DO UPDATE SET
           enabled=$2, notify_after_sec=$3, escalate_interval_min=$4, escalate_once=$5,
           quiet_from=$6, quiet_to=$7, recipient_ids=$8, updated_at=NOW()`,
        [cameraId, !!enabled, notifyAfter, escalateMin, escalateOnce, qf, qt, String(recipient_ids || '').trim()]
      );
      const after = {
        enabled: !!enabled,
        notify_after_sec: notifyAfter,
        escalate_interval_min: escalateMin,
        escalate_once: escalateOnce,
        quiet_from: qf,
        quiet_to: qt,
        recipient_ids: String(recipient_ids || '').trim(),
      };
      await _logCameraAudit(req, 'camera_offline_alert_update', cameraId, {
        camera_id: cameraId,
        changed_fields: _diffAuditObjects(before, after),
      });
      res.json({ success: true });
    } catch (err) { routeError(res, err, 'PUT /api/camera-offline-alerts/:cameraId'); }
  });

  // GET /api/cameras/status-current — current operational snapshot for the
  // History › Camera Status view. `updated_at` is the DB row update time and may
  // include runtime updates, so the UI labels it as data update, not config edit.
  app.get('/api/cameras/status-current', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const cfgCameras = (loadCameraConfig().cameras || []);
      const cfgIds = cfgCameras.map(c => c.camera_id || c.id).filter(Boolean);
      if (cfgIds.length === 0) {
        return res.json({ summary: { total: 0, online: 0, offline: 0 }, cameras: [] });
      }

      const { rows } = await pool.query(`
        WITH last_events AS (
          SELECT camera_id, MAX(event_time) AS last_event_at
          FROM events
          WHERE camera_id = ANY($1::text[])
          GROUP BY camera_id
        )
        SELECT c.id AS camera_id, c.created_at, c.updated_at, c.last_seen_at,
               c.paused, le.last_event_at
        FROM cameras c
        LEFT JOIN last_events le ON le.camera_id = c.id
        WHERE c.id = ANY($1::text[])
      `, [cfgIds]);

      const dbById = {};
      rows.forEach(r => { dbById[r.camera_id] = r; });
      const now = Date.now();
      const camerasCurrent = cfgCameras.map(c => {
        const cameraId = c.camera_id || c.id;
        const db = dbById[cameraId] || {};
        const lastSeenMs = db.last_seen_at ? new Date(db.last_seen_at).getTime() : 0;
        const _thr = c.push_only ? PUSH_ONLY_OFFLINE_SEC : OFFLINE_THRESHOLD_SEC;
        const status = db.paused ? 'paused'
          : (lastSeenMs && (now - lastSeenMs) / 1000 < _thr ? 'online' : 'offline');
        let offlineForSec = null;
        if (status === 'offline') {
          offlineForSec = lastSeenMs ? Math.max(0, Math.round((now - lastSeenMs) / 1000)) : null;
        }
        return {
          camera_id: cameraId,
          camera_name: c.camera_name || cameraId,
          vendor: c.vendor || 'bosch',
          status,
          created_at: db.created_at || null,
          updated_at: db.updated_at || null,
          last_seen_at: db.last_seen_at || null,
          last_event_at: db.last_event_at || null,
          offline_for_sec: offlineForSec,
        };
      });

      res.json({
        summary: {
          total: camerasCurrent.length,
          online: camerasCurrent.filter(c => c.status === 'online').length,
          offline: camerasCurrent.filter(c => c.status === 'offline').length,
          paused: camerasCurrent.filter(c => c.status === 'paused').length,
        },
        cameras: camerasCurrent,
      });
    } catch (err) { routeError(res, err, 'GET /api/cameras/status-current'); }
  });

  // GET /api/cameras/status-log — paginated transition history
  app.get('/api/cameras/status-log', auth.requireAuth, async (req, res) => {
    try {
      const cameraId = req.query.camera_id || null;
      const status   = ['online', 'offline'].includes(req.query.status) ? req.query.status : null;
      const limit    = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset   = Math.max(0, parseInt(req.query.offset, 10) || 0);

      const params = [limit, offset];
      const where = [];
      let paramIndex = 3;
      if (cameraId) {
        where.push(`camera_id = $${paramIndex++}`);
        params.push(cameraId);
      }
      if (status) {
        where.push(`status = $${paramIndex++}`);
        params.push(status);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `SELECT id, camera_id, status, changed_at, reason,
                COUNT(*) OVER () AS total_count
         FROM camera_status_log
         ${whereSql}
         ORDER BY changed_at DESC
         LIMIT $1 OFFSET $2`, params
      );
      const total = rows[0]?.total_count ? parseInt(rows[0].total_count, 10) : 0;
      res.set('X-Total-Count', String(total));
      res.json(rows.map(r => ({
        id: r.id, camera_id: r.camera_id, status: r.status,
        changed_at: r.changed_at, reason: r.reason,
      })));
    } catch (err) { routeError(res, err, 'GET /api/cameras/status-log'); }
  });

  // GET /api/cameras/image-quality-log — paginated camera diagnostics history.
  // These are automation/diagnostic signals, not incident/snapshot events.
  app.get('/api/cameras/image-quality-log', auth.requireAdminOrAuditor, async (req, res) => {
    try {
      const cameraId = req.query.camera_id || null;
      const type = ['ImageTooBright', 'ImageTooBlurry', 'ImageTooDark', 'GlobalSceneChange'].includes(req.query.type)
        ? req.query.type
        : null;
      const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

      const params = [limit, offset];
      const where = [
        `(e.event_type LIKE 'ImageTooBright/%'
          OR e.event_type LIKE 'ImageTooBlurry/%'
          OR e.event_type LIKE 'ImageTooDark/%'
          OR e.event_type LIKE 'GlobalSceneChange/%')`,
      ];
      let paramIndex = 3;
      if (cameraId) {
        where.push(`e.camera_id = $${paramIndex++}`);
        params.push(cameraId);
      }
      if (type) {
        where.push(`e.event_type LIKE $${paramIndex++}`);
        params.push(`${type}/%`);
      }

      const { rows } = await pool.query(
        `SELECT e.id, e.camera_id, e.event_type, e.event_state, e.event_time,
                COUNT(*) OVER () AS total_count
         FROM events e
         WHERE ${where.join(' AND ')}
         ORDER BY e.event_time DESC
         LIMIT $1 OFFSET $2`, params
      );
      const total = rows[0]?.total_count ? parseInt(rows[0].total_count, 10) : 0;
      res.set('X-Total-Count', String(total));
      res.json(rows.map(r => ({
        id: r.id,
        camera_id: r.camera_id,
        event_type: r.event_type,
        event_state: r.event_state,
        event_time: r.event_time,
      })));
    } catch (err) { routeError(res, err, 'GET /api/cameras/image-quality-log'); }
  });

  // ============================================================
  // API: Live Snapshot Proxy
  // ============================================================

  // Cameras the server can't pull a live frame from (push-only / behind NAT).
  // Auto-detected on live-pull failure; entries expire so a recovered camera
  // resumes live within 60s. push_only in config is the manual override.
  const _LIVE_UNREACHABLE = new Map(); // cameraId → expiry epoch ms

  app.get('/api/snapshot/live/:cameraId', async (req, res) => {
    const { cameraId } = req.params;
    const config = loadCameraConfig();
    const cam = (config.cameras || []).find(c => c.camera_id === cameraId);
    if (!cam || !cam.ip_address) return res.status(404).json({ error: 'Camera IP not configured' });

    // Phase 6.1.4 — honor per-camera VCA overlay toggle for the Live snapshot proxy too
    let withOverlay = true;   // default true (preserves prior visual behaviour)
    // Edge-site cameras live on a remote LAN behind the tunnel — central can't
    // reach their IP, so a live pull just times out (~6s) before falling back to
    // the tile. Detect it here (mirrors the /snapshots proxy's is_local_site) and
    // skip straight to the periodic tile below.
    let isEdgeSite = false;
    try {
      const r = await pool.query(
        `SELECT c.enable_snapshot, c.enable_vca_overlay, c.paused,
                (c.site_id IS NOT NULL AND s.code IS DISTINCT FROM 'main') AS is_edge_site
           FROM cameras c LEFT JOIN sites s ON s.id = c.site_id
          WHERE c.id=$1`,
        [cameraId]
      );
      if (r.rows[0]) {
        if (r.rows[0].paused === true) {
          return res.status(503).json({ error: 'Camera paused for maintenance', paused: true });
        }
        if (r.rows[0].enable_snapshot === false) {
          return res.status(403).json({ error: 'Snapshot disabled for this camera' });
        }
        withOverlay = r.rows[0].enable_vca_overlay !== false;
        isEdgeSite  = r.rows[0].is_edge_site === true;
      }
    } catch {}

    // Helper: ส่ง response ครั้งเดียวเท่านั้น (กัน ERR_HTTP_HEADERS_SENT)
    let responseSent = false;

    // Auto preview fallback: when a live frame can't be pulled (push-only /
    // unreachable camera), serve the most recent captured snapshot instead of an
    // error — generic across vendors + event types. Returns true if it responded.
    const serveLatestSnapshot = async () => {
      if (responseSent || res.headersSent) return false;
      const w = req.query.w ? `?w=${encodeURIComponent(req.query.w)}` : '';
      const redirect = (file) => {
        responseSent = true;
        res.redirect(302, `/snapshots/${file.split('/').map(encodeURIComponent).join('/')}${w}`);
      };
      try {
        // NVR channels: some Dahua NVRs ignore the channel param on snapshot.cgi,
        // so the periodic tile is the SAME feed for every channel (live-verified
        // 2026-07-17). The per-face-event scene (_snapshot_full, fetched via RPC2)
        // IS channel-correct — prefer it for NVR channels so each shows its own view.
        const nvr = await pool.query(`SELECT nvr_channel FROM cameras WHERE id=$1`, [cameraId]);
        if (nvr.rows[0]?.nvr_channel != null) {
          const sc = await pool.query(
            `SELECT raw_json->>'_snapshot_full' AS scene FROM events
               WHERE camera_id = $1 AND raw_json->>'_snapshot_full' IS NOT NULL
               ORDER BY event_time DESC LIMIT 1`, [cameraId]);
          if (sc.rows[0]?.scene) { redirect(sc.rows[0].scene); return true; }
        }
        // Prefer periodic full-scene tile preview over event snapshot (face/LPR cameras
        // would otherwise show a face crop from their most recent recognition event).
        const tp = await pool.query(
          `SELECT tile_snap_file FROM cameras WHERE id=$1 AND tile_snap_file IS NOT NULL`,
          [cameraId]);
        if (tp.rows[0]) { redirect(tp.rows[0].tile_snap_file); return true; }

        const r = await pool.query(
          `SELECT snapshot_filename FROM events
             WHERE camera_id = $1 AND has_snapshot = TRUE AND snapshot_filename IS NOT NULL
             ORDER BY event_time DESC LIMIT 1`, [cameraId]);
        if (responseSent || res.headersSent) return true;
        if (r.rows[0]) { redirect(r.rows[0].snapshot_filename); return true; }
      } catch { /* fall through to error */ }
      return false;
    };

    // live-pull failed → mark unreachable (skip the slow live attempt for 60s) and
    // fall back to the latest snapshot; only surface the error if none exists.
    const sendError = (status, msg) => {
      if (responseSent || res.headersSent) return;
      _LIVE_UNREACHABLE.set(cameraId, Date.now() + 60000);
      serveLatestSnapshot().then(served => {
        if (!served && !responseSent && !res.headersSent) { responseSent = true; res.status(status).json({ error: msg }); }
      }).catch(() => {});
    };

    // Manual override (push_only), edge-site camera (unreachable LAN IP), or
    // recently-unreachable → skip live entirely and serve the periodic tile (instant).
    if (cam.push_only || isEdgeSite || (_LIVE_UNREACHABLE.get(cameraId) > Date.now())) {
      if (await serveLatestSnapshot()) return;
      if (!responseSent) { responseSent = true; res.status(404).json({ error: 'no snapshot available' }); }
      return;
    }

    const vendor = String(cam.vendor || 'bosch').toLowerCase();
    const port = cam.http_port || 80;
    // ?w=N → resize the live frame in-flight (Camera Status grid asks
    // for a small thumbnail; the "view full" path omits ?w).
    const resizeW = thumbWidth(req.query.w);

    if (vendor === 'hikvision') {
      // Pick the ISAPI channel by the requested size:
      //  - small thumbnail (grid ?w<=400, detail hero ?w=640) → the
      //    sub-stream (channel 102, ~720p): the 4K main is ~700KB/frame
      //    and several Camera Status cards at once would stall the page.
      //  - "view full" (large ?w, or no ?w) → the main / snapshot_stream
      //    channel so the requested resolution actually EXISTS.
      // Hard-coding channel 102 here previously capped the "view full"
      // button + the per-camera full_view_width at 720p regardless of
      // the camera settings.
      const big = !resizeW || resizeW > 640;
      const ch  = big ? (parseInt(cam.snapshot_stream, 10) || 1) : 2;
      const uri = `/ISAPI/Streaming/channels/10${ch}/picture`;
      _hikDigestSnapshot(cam.ip_address, port, uri,
        cam.username || '', cam.password || '', res, sendError, resizeW);
      return;
    }

    if (vendor === 'dahua') {
      // Dahua CGI snapshot — digest auth. The default path covers most
      // single-channel models; snapshot_path overrides for NVR / multi-channel.
      const uri = cam.snapshot_path || '/cgi-bin/snapshot.cgi?channel=1';
      _hikDigestSnapshot(cam.ip_address, port, uri,
        cam.username || '', cam.password || '', res, sendError, resizeW);
      return;
    }

    if (vendor === 'onvif') {
      // Generic ONVIF / monitor-only — the still-image URL varies per model,
      // so the operator supplies snapshot_path. _hikDigestSnapshot handles
      // both Digest and Basic auth challenges.
      if (!cam.snapshot_path) {
        return sendError(400, 'ONVIF camera: ตั้งค่า Snapshot URL Path ในหน้าตั้งค่ากล้องก่อน');
      }
      _hikDigestSnapshot(cam.ip_address, port, cam.snapshot_path,
        cam.username || '', cam.password || '', res, sendError, resizeW);
      return;
    }

    // Bosch: snap.jpg endpoint, Basic auth. JpegSize omitted → the camera
    // returns its NATIVE resolution (was hard-coded 1280x720, which capped
    // the "view full" button); the ?w=N resize below scales it down for
    // grid / modal thumbnails server-side.
    const url = `http://${cam.ip_address}:${port}/snap.jpg${withOverlay ? '?VCAOverlay=1' : ''}`;
    const options = { timeout: 5000, headers: {} };
    if (cam.username && cam.password) {
      options.headers['Authorization'] = 'Basic ' + Buffer.from(`${cam.username}:${cam.password}`).toString('base64');
    }

    const proxyReq = http.get(url, options, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        proxyRes.resume(); // drain response
        return sendError(502, `Camera returned ${proxyRes.statusCode}`);
      }
      if (responseSent) { proxyRes.resume(); return; }
      responseSent = true;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-cache');
      if (resizeW) {
        const t = jpegResizer(resizeW);
        t.on('error', () => { try { res.end(); } catch {} });
        proxyRes.pipe(t).pipe(res);
      } else {
        proxyRes.pipe(res);
      }
      proxyRes.on('error', () => res.end());
    });
    proxyReq.on('error', (err) => sendError(502, err.message));
    proxyReq.on('timeout', () => { proxyReq.destroy(); sendError(504, 'Timeout'); });
  });

};

// CS6: expose the pure forward-URL validator for node tests (SSRF write guard).
module.exports._validateForwardUrl = _validateForwardUrl;
